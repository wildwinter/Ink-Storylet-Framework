// Copyright (c) 2020 Ian Thomas (https://github.com/wildwinter). All rights reserved.
// Licensed under the MIT license.
// See LICENSE file in the Git repository root directory for full license information.

using System;
using System.Collections.Generic;
using Ink.Runtime;
using UnityEngine;

namespace InkStoryletFramework
{
    public class StoryletsManager
    {
        #region Public

        public int StoryletsToProcessPerFrame = 5;
        public Action OnRefreshComplete;
        public bool IsReady => _state == State.REFRESH_COMPLETE;
        public bool IsRefreshing => _state == State.REFRESHING;
        public bool NeedsRefresh => _state == State.NEEDS_REFRESH;
        
        // Pass in a loaded Ink Story
        public StoryletsManager(Story story)
        {
            _story = story;
        }

        // Call with a prefix e.g. "story_" will scan all the
        // knot IDs in the ink file that start with story_ and treat
        // them as a story.
        //
        // Remember each storylet must also have a function called
        // the same but with an underscore in front e.g.
        // a story called story_troll_attack needs a function called
        // _story_troll_attack()
        // The function must either return true/false ("is this available?")
        // or instead can return an integer weighting - the higher the integer,
        // the more changes that card gets of being picked randomly. (i.e. the more
        // copies of that card ends up in the current hand of cards!)
        //
        // If a knot has the tag #once
        // then it will be discarded after
        // use, otherwise each storylet will
        // be shuffled back in.
        //
        // IMPORTANT: Once you have called all the AddStorylets you need to,
        // make sure you call Refresh()!
        public void AddStorylets(string prefix)
        {
            List<string> knotIDs = GetAllKnotIDs();

            foreach (string knotID in knotIDs)
            {
                if (knotID.StartsWith(prefix))
                {
                    // Using a _ as a prefix for the function
                    string functionName = "_" + knotID;
                    if (!knotIDs.Contains(functionName))
                    {
                        Debug.LogError($"Can't find test function {functionName} for storylet {knotID}.");
                        continue;
                    }

                    Storylet storylet = new(knotID);
                    _deck[knotID] = storylet;
                    List<string> tags = _story.TagsForContentAtPath(knotID);
                    if (tags!=null)
                        storylet.once = tags.Contains("once");
                }
            }

            _state = State.NEEDS_REFRESH;
        }

        // Start a refresh process. You won't be
        // able to call GetPlayableStorylets() or
        // do anything else until 
        // OnRefreshComplete is called, or
        // IsReady is true.
        // You will always need to call this at
        // the start of the game once you have called
        // AddStorylets()
        public void Refresh()
        {
            _hand.Clear();
            _handWeighted.Clear();
            _refreshList = new List<Storylet>(_deck.Values);
            _state = State.REFRESHING;
        }
        
        // IMPORTANT Must be called every frame to make
        // sure refreshing of cards actually works.
        // Calling it in an Update() somewhere is usually good.
        public void Tick()
        {
            if (_state != State.REFRESHING)
                return;

            if (_refreshList.Count > 0)
            {
                int refreshCount = Math.Min(StoryletsToProcessPerFrame, _refreshList.Count);
                for (int i = 0; i < refreshCount; i++)
                {
                    Storylet storylet = _refreshList[0];
                    _refreshList.RemoveAt(0);

                    int weighting = GetWeighting(storylet);
                    if (weighting == 0)
                        continue;

                    _hand.Add(storylet.knotID);

                    for (int j = 0; j < weighting; j++)
                        _handWeighted.Add(storylet.knotID);
                }
            }

            if (_refreshList.Count == 0)
            {
                _state = State.REFRESH_COMPLETE;
                OnRefreshComplete?.Invoke();
            }
        }

        // Returns a list of knotIDs that are currently available,
        // assuming all the functions have been tested.
        // If weighted is true, returns multiple copies of anything which
        // has a weighting>1
        //
        // Once you or the player has picked a storylet from list list,
        // make sure you called MarkPlayed(knotID) on the storylet!
        public List<string> GetPlayableStorylets(bool weighted = false)
        {
            if (_state != State.REFRESH_COMPLETE)
            {
                Debug.LogError("Don't call GetPlayableStorylets until refresh is complete!");
                return null;
            }

            if (!weighted)
                return _hand;
            return _handWeighted;
        }
        
        // Call this if you use a storylet from the playable list
        // returned by GetPlayableStorylets
        public void MarkPlayed(string knotID)
        {
            _deck[knotID].played = true;
        }

        // Gives you a random storylet from the currently
        // playable selection (hand of cards).
        // Automatically marks it as played.
        public string PickPlayableStorylet()
        {
            if (_state != State.REFRESH_COMPLETE)
            {
                Debug.LogError("Don't call PickPlayableStorylet until refresh is complete!");
                return null;
            }

            if (_handWeighted.Count == 0)
                return null;

            int i = UnityEngine.Random.Range(0, _handWeighted.Count);
            string knotID = _handWeighted[i];
            MarkPlayed(knotID);
            return knotID;
        }

        // Throw out any played data and start from scratch.
        // Bear in mind you might have to reset your ink story
        // as well to reset any ink variables!
        public void Reset()
        {
            foreach (Storylet storylet in _deck.Values)
            {
                storylet.played = false;
            }

            _refreshList.Clear();
            _hand.Clear();
            _handWeighted.Clear();
            _state = State.NEEDS_REFRESH;
        }
        
        // This just saves the state of which storylets have been played
        // You'll need to save the ink story state separately.
        // Uses SimpleJson which comes as part of Ink's runtime
        public string SaveAsJson()
        {
            var writer = new SimpleJson.Writer();
            writer.WriteArrayStart();
            foreach (Storylet storylet in _deck.Values)
            {
                writer.WriteArrayStart();
                writer.Write(storylet.knotID);
                writer.Write(storylet.played);
                writer.WriteArrayEnd();
            }

            writer.WriteArrayEnd();
            return writer.ToString();
        }

        // This loads the state from SaveAsJson. Again, this
        // takes no account of any Ink variables.
        public void LoadFromJson(string json)
        {
            Reset();
            List<object> jsonStorylets = SimpleJson.TextToArray(json);
            foreach (object jsonStorylet in jsonStorylets)
            {
                List<object> jsonList = jsonStorylet as List<object>;
                string knotID = (string)jsonList[0];
                bool played = (bool)jsonList[1];
                if (_deck.TryGetValue(knotID, out Storylet storylet))
                    storylet.played = played;
            }
        }

        #endregion

        private readonly Story _story;
        private readonly List<string> _hand = new();
        private readonly List<string> _handWeighted = new();
        private readonly Dictionary<string, Storylet> _deck = new();

        private enum State
        {
            NEEDS_REFRESH,
            REFRESHING,
            REFRESH_COMPLETE
        }
        private State _state = State.NEEDS_REFRESH;
        private List<Storylet> _refreshList = new();

        private int GetWeighting(Storylet storylet)
        {
            if (storylet.played && storylet.once)
                return 0;
            
            object retVal = _story.EvaluateFunction("_" + storylet.knotID);
            if (retVal is bool playable)
                return playable ? 1 : 0;

            if (retVal is int i)
                return i;

            Debug.LogError($"Wrong value returned from storylet function _{storylet.knotID} - should be bool or int!");
            return 0;
        }

        private List<string> GetAllKnotIDs()
        {
            // This is a hack which works on the current
            // Ink runtime internals as of 1.1.7 but beware!

            List<string> knotList = new();

            Container mainContentContainer = _story.mainContentContainer;
            if (mainContentContainer == null)
                return knotList;

            foreach (string name in mainContentContainer.namedOnlyContent.Keys)
            {
                // Don't want this as it's Ink internal
                if (name == "global decl")
                    continue;

                knotList.Add(name);
            }

            return knotList;
        }

        internal class Storylet
        {
            internal readonly string knotID;
            internal bool played;
            internal bool once;

            internal Storylet(string knotID)
            {
                this.knotID = knotID;
            }
        }
    }
}