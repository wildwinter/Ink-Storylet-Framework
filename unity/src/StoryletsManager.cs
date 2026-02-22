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

        // Called once per pool each time that pool's refresh completes,
        // with the pool name as the argument.
        public Action<string> OnRefreshComplete;

        // Pass in a loaded Ink Story
        public StoryletsManager(Story story)
        {
            _story = story;
        }

        // Returns true if the given pool (default: "default") has a completed refresh.
        public bool IsReady(string pool = DefaultPool)
        {
            PoolState poolState = GetPoolState(pool);
            return poolState != null && poolState.State == State.REFRESH_COMPLETE;
        }

        // Returns true if the given pool (default: "default") is currently refreshing.
        public bool IsRefreshing(string pool = DefaultPool)
        {
            PoolState poolState = GetPoolState(pool);
            return poolState != null && poolState.State == State.REFRESHING;
        }

        // Returns true if the given pool (default: "default") needs a refresh.
        public bool NeedsRefresh(string pool = DefaultPool)
        {
            PoolState poolState = GetPoolState(pool);
            return poolState == null || poolState.State == State.NEEDS_REFRESH;
        }

        // Returns true if every registered pool has a completed refresh.
        public bool AreAllReady()
        {
            if (_pools.Count == 0) return false;
            foreach (PoolState poolState in _pools.Values)
            {
                if (poolState.State != State.REFRESH_COMPLETE) return false;
            }
            return true;
        }

        // Call with a prefix e.g. "story_" will scan all the
        // knot IDs in the ink file that start with story_ and treat
        // them as a story. An optional pool name groups them into
        // an independently queryable set (defaults to "default").
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
        public void AddStorylets(string prefix, string pool = DefaultPool)
        {
            List<string> knotIDs = GetAllKnotIDs();
            PoolState poolState = GetOrCreatePoolState(pool);

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
                    poolState.Deck[knotID] = storylet;
                    List<string> tags = _story.TagsForContentAtPath(knotID);
                    if (tags != null)
                        storylet.once = tags.Contains("once");
                }
            }

            poolState.State = State.NEEDS_REFRESH;
        }

        // Start a refresh process for a specific pool, or all registered pools
        // if no pool is specified.
        // You won't be able to call GetPlayableStorylets() or do anything else
        // until OnRefreshComplete is called (once per pool), or IsReady() is true.
        // You will always need to call this at the start of the game once you
        // have called AddStorylets().
        public void Refresh(string pool = null)
        {
            if (pool != null)
            {
                PoolState poolState = GetOrCreatePoolState(pool);
                poolState.Hand.Clear();
                poolState.HandWeighted.Clear();
                poolState.RefreshList = new List<Storylet>(poolState.Deck.Values);
                poolState.State = State.REFRESHING;
            }
            else
            {
                foreach (PoolState poolState in _pools.Values)
                {
                    poolState.Hand.Clear();
                    poolState.HandWeighted.Clear();
                    poolState.RefreshList = new List<Storylet>(poolState.Deck.Values);
                    poolState.State = State.REFRESHING;
                }
            }
        }

        // IMPORTANT Must be called every frame to make
        // sure refreshing of cards actually works.
        // Calling it in an Update() somewhere is usually good.
        // Processes up to StoryletsToProcessPerFrame items per refreshing pool per frame.
        public void Tick()
        {
            foreach (KeyValuePair<string, PoolState> kvp in _pools)
            {
                PoolState poolState = kvp.Value;
                if (poolState.State != State.REFRESHING)
                    continue;

                if (poolState.RefreshList.Count > 0)
                {
                    int refreshCount = Math.Min(StoryletsToProcessPerFrame, poolState.RefreshList.Count);
                    for (int i = 0; i < refreshCount; i++)
                    {
                        Storylet storylet = poolState.RefreshList[0];
                        poolState.RefreshList.RemoveAt(0);

                        int weighting = GetWeighting(storylet);
                        if (weighting == 0)
                            continue;

                        poolState.Hand.Add(storylet.knotID);

                        for (int j = 0; j < weighting; j++)
                            poolState.HandWeighted.Add(storylet.knotID);
                    }
                }

                if (poolState.RefreshList.Count == 0)
                {
                    poolState.State = State.REFRESH_COMPLETE;
                    OnRefreshComplete?.Invoke(kvp.Key);
                }
            }
        }

        // Returns a list of knotIDs that are currently available for the given
        // pool (default: "default"), assuming all the functions have been tested.
        // If weighted is true, returns multiple copies of anything which
        // has a weighting>1
        //
        // Once you or the player has picked a storylet from this list,
        // make sure you call MarkPlayed(knotID) on the storylet!
        public List<string> GetPlayableStorylets(bool weighted = false, string pool = DefaultPool)
        {
            PoolState poolState = GetPoolState(pool);
            if (poolState == null || poolState.State != State.REFRESH_COMPLETE)
            {
                Debug.LogError($"Don't call GetPlayableStorylets until refresh is complete for pool \"{pool}\"!");
                return null;
            }

            return weighted ? poolState.HandWeighted : poolState.Hand;
        }

        // Call this if you use a storylet from the playable list
        // returned by GetPlayableStorylets.
        public void MarkPlayed(string knotID, string pool = DefaultPool)
        {
            if (_pools.TryGetValue(pool, out PoolState poolState))
            {
                if (poolState.Deck.TryGetValue(knotID, out Storylet storylet))
                    storylet.played = true;
            }
        }

        // Gives you a random storylet from the currently playable selection
        // of the given pool (default: "default").
        // Automatically marks it as played.
        public string PickPlayableStorylet(string pool = DefaultPool)
        {
            PoolState poolState = GetPoolState(pool);
            if (poolState == null || poolState.State != State.REFRESH_COMPLETE)
            {
                Debug.LogError($"Don't call PickPlayableStorylet until refresh is complete for pool \"{pool}\"!");
                return null;
            }

            if (poolState.HandWeighted.Count == 0)
                return null;

            int i = UnityEngine.Random.Range(0, poolState.HandWeighted.Count);
            string knotID = poolState.HandWeighted[i];
            MarkPlayed(knotID, pool);
            return knotID;
        }

        // Throw out any played data for a specific pool, or all pools if none
        // is specified. Bear in mind you might have to reset your ink story
        // as well to reset any ink variables!
        public void Reset(string pool = null)
        {
            if (pool != null)
            {
                if (_pools.TryGetValue(pool, out PoolState poolState))
                    ResetPoolState(poolState);
            }
            else
            {
                foreach (PoolState poolState in _pools.Values)
                    ResetPoolState(poolState);
            }
        }

        // This just saves the state of which storylets have been played,
        // across all pools. You'll need to save the ink story state separately.
        // Uses SimpleJson which comes as part of Ink's runtime.
        // Format: { "poolName": [["knotID", played], ...], ... }
        public string SaveAsJson()
        {
            var writer = new SimpleJson.Writer();
            writer.WriteObjectStart();
            foreach (KeyValuePair<string, PoolState> poolKvp in _pools)
            {
                writer.WritePropertyStart(poolKvp.Key);
                writer.WriteArrayStart();
                foreach (Storylet storylet in poolKvp.Value.Deck.Values)
                {
                    writer.WriteArrayStart();
                    writer.Write(storylet.knotID);
                    writer.Write(storylet.played);
                    writer.WriteArrayEnd();
                }
                writer.WriteArrayEnd();
                writer.WritePropertyEnd();
            }
            writer.WriteObjectEnd();
            return writer.ToString();
        }

        // This loads the state from SaveAsJson. Again, this
        // takes no account of any Ink variables.
        public void LoadFromJson(string json)
        {
            Reset();
            Dictionary<string, object> jsonPools = SimpleJson.TextToDictionary(json);
            foreach (KeyValuePair<string, object> poolKvp in jsonPools)
            {
                if (!_pools.TryGetValue(poolKvp.Key, out PoolState poolState))
                    continue;
                List<object> jsonStorylets = poolKvp.Value as List<object>;
                foreach (object jsonStorylet in jsonStorylets)
                {
                    List<object> jsonList = jsonStorylet as List<object>;
                    string knotID = (string)jsonList[0];
                    bool played = (bool)jsonList[1];
                    if (poolState.Deck.TryGetValue(knotID, out Storylet storylet))
                        storylet.played = played;
                }
            }
        }

        #endregion

        private const string DefaultPool = "default";

        private readonly Story _story;
        private readonly Dictionary<string, PoolState> _pools = new();

        private enum State
        {
            NEEDS_REFRESH,
            REFRESHING,
            REFRESH_COMPLETE
        }

        private PoolState GetOrCreatePoolState(string pool)
        {
            if (!_pools.TryGetValue(pool, out PoolState poolState))
            {
                poolState = new PoolState();
                _pools[pool] = poolState;
            }
            return poolState;
        }

        private PoolState GetPoolState(string pool)
        {
            _pools.TryGetValue(pool, out PoolState poolState);
            return poolState;
        }

        private static void ResetPoolState(PoolState poolState)
        {
            foreach (Storylet storylet in poolState.Deck.Values)
                storylet.played = false;
            poolState.RefreshList.Clear();
            poolState.Hand.Clear();
            poolState.HandWeighted.Clear();
            poolState.State = State.NEEDS_REFRESH;
        }

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

        private class PoolState
        {
            internal readonly Dictionary<string, Storylet> Deck = new();
            internal readonly List<string> Hand = new();
            internal readonly List<string> HandWeighted = new();
            internal List<Storylet> RefreshList = new();
            internal State State = State.NEEDS_REFRESH;
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
