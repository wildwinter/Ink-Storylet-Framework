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

        // Pass in a loaded Ink Story. Any #storylets: global tags in the Ink file
        // are parsed and registered automatically.
        public StoryletsManager(Story story)
        {
            _story = story;
            AddStoryletsFromGlobalTags();
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

        // Discover all knots starting with `name_` and register them into `pool`.
        //
        // The underscore is inferred: AddStorylets("encounters") finds all knots
        // beginning with "encounters_" and uses "_encounters()" as an optional group
        // predicate. If that function exists in Ink it is evaluated once per refresh
        // before any individual storylet predicates in the group — if it returns false
        // the entire group is skipped.
        //
        // Each storylet knot must have a predicate function _knotID() that returns
        // bool (available?) or int (weight for random selection).
        //
        // Tag #once on a knot means that storylet is discarded after its first play.
        //
        // IMPORTANT: After calling AddStorylets(), call Refresh() and wait for
        // OnRefreshComplete before querying the available storylets.
        public void AddStorylets(string name, string pool = DefaultPool)
        {
            string prefix = name + "_";
            List<string> knotIDs = GetAllKnotIDs();
            PoolState poolState = GetOrCreatePoolState(pool);

            // Determine group predicate (optional — only used if the function exists)
            string groupPredFn = "_" + name;
            string groupPredicate = knotIDs.Contains(groupPredFn) ? groupPredFn : null;

            foreach (string knotID in knotIDs)
            {
                if (!knotID.StartsWith(prefix))
                    continue;

                string functionName = "_" + knotID;
                if (!knotIDs.Contains(functionName))
                {
                    Debug.LogError($"Can't find predicate function {functionName} for storylet {knotID}.");
                    continue;
                }

                Storylet storylet = new(knotID);
                storylet.GroupPredicate = groupPredicate;
                poolState.Deck[knotID] = storylet;

                // Parse and cache all tags for this storylet
                List<string> tags = _story.TagsForContentAtPath(knotID);
                Dictionary<string, object> parsedTags = ParseTags(tags);
                _storyletTags[knotID] = parsedTags;

                if (parsedTags.TryGetValue("once", out object onceVal) && onceVal is bool onceBool)
                    storylet.once = onceBool;
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
                poolState.RefreshList = BuildRefreshList(poolState);
                poolState.State = State.REFRESHING;
            }
            else
            {
                foreach (PoolState poolState in _pools.Values)
                {
                    poolState.Hand.Clear();
                    poolState.HandWeighted.Clear();
                    poolState.RefreshList = BuildRefreshList(poolState);
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
        // If pool is null, all pools are searched (safe — missing knotIDs are ignored).
        public void MarkPlayed(string knotID, string pool = null)
        {
            if (pool != null)
            {
                if (_pools.TryGetValue(pool, out PoolState poolState))
                {
                    if (poolState.Deck.TryGetValue(knotID, out Storylet storylet))
                        storylet.played = true;
                }
            }
            else
            {
                foreach (PoolState poolState in _pools.Values)
                {
                    if (poolState.Deck.TryGetValue(knotID, out Storylet storylet))
                        storylet.played = true;
                }
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

        // Returns the value of a named tag on a storylet knot, or defaultValue if absent.
        // Tag names are case-insensitive. Values are parsed at registration time:
        //   - "true"/"false" strings become booleans
        //   - bare tags (no colon) become true
        //   - everything else is returned as a trimmed string
        public object GetStoryletTag(string knotID, string tagName, object defaultValue = null)
        {
            if (!_storyletTags.TryGetValue(knotID, out Dictionary<string, object> tags))
                return defaultValue;
            string key = tagName.ToLower();
            return tags.TryGetValue(key, out object val) ? val : defaultValue;
        }

        // Returns all playable storylets whose tag `tagName` equals `tagValue`.
        // If pool is provided only that pool is searched; otherwise all pools are searched.
        public List<string> GetPlayableStoryletsWithTag(string tagName, object tagValue, string pool = null)
        {
            string key = tagName.ToLower();
            List<string> result = new List<string>();

            IEnumerable<PoolState> poolsToSearch = (pool != null)
                ? (_pools.TryGetValue(pool, out PoolState ps) ? new[] { ps } : Array.Empty<PoolState>())
                : (IEnumerable<PoolState>)_pools.Values;

            foreach (PoolState poolState in poolsToSearch)
            {
                if (poolState.State != State.REFRESH_COMPLETE) continue;
                foreach (string knotID in poolState.Hand)
                {
                    if (_storyletTags.TryGetValue(knotID, out Dictionary<string, object> tags)
                        && tags.TryGetValue(key, out object val)
                        && Equals(val, tagValue))
                    {
                        result.Add(knotID);
                    }
                }
            }
            return result;
        }

        // Returns the first playable storylet whose tag `tagName` equals `tagValue`, or null.
        // If pool is provided only that pool is searched; otherwise all pools are searched.
        public string GetFirstPlayableStoryletWithTag(string tagName, object tagValue, string pool = null)
        {
            List<string> matches = GetPlayableStoryletsWithTag(tagName, tagValue, pool);
            return matches.Count > 0 ? matches[0] : null;
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

        // Tag cache: knotID -> { tagName -> value }
        private readonly Dictionary<string, Dictionary<string, object>> _storyletTags = new();

        private enum State
        {
            NEEDS_REFRESH,
            REFRESHING,
            REFRESH_COMPLETE
        }

        // Parse #storylets: global tags and call AddStorylets() for each.
        // Tag format: #storylets:name  or  #storylets:name,poolName
        private void AddStoryletsFromGlobalTags()
        {
            IList<string> globalTags = _story.globalTags;
            if (globalTags == null) return;
            foreach (string tag in globalTags)
            {
                if (!tag.StartsWith("storylets:")) continue;
                string[] parts = tag.Substring("storylets:".Length).Split(',');
                string name = parts[0].Trim();
                string pool = parts.Length > 1 ? parts[1].Trim() : DefaultPool;
                if (!string.IsNullOrEmpty(name))
                    AddStorylets(name, pool);
            }
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

        // Evaluate unique group predicates for a pool's deck, then build the refresh
        // list excluding storylets in inactive groups. Called synchronously in Refresh()
        // so that external functions bound to the story are accessible.
        private List<Storylet> BuildRefreshList(PoolState poolState)
        {
            // Evaluate each unique group predicate once
            Dictionary<string, bool> groupResults = new Dictionary<string, bool>();
            foreach (Storylet storylet in poolState.Deck.Values)
            {
                string gp = storylet.GroupPredicate;
                if (gp != null && !groupResults.ContainsKey(gp))
                {
                    bool active = false;
                    try
                    {
                        object retVal = _story.EvaluateFunction(gp);
                        if (retVal is bool b) active = b;
                        else if (retVal is int i) active = i > 0;
                    }
                    catch (Exception)
                    {
                        active = true; // Missing function → group always active
                    }
                    groupResults[gp] = active;
                }
            }

            // Build refresh list, skipping storylets in inactive groups
            List<Storylet> refreshList = new List<Storylet>();
            foreach (Storylet storylet in poolState.Deck.Values)
            {
                string gp = storylet.GroupPredicate;
                if (gp != null && groupResults.TryGetValue(gp, out bool groupActive) && !groupActive)
                    continue;
                refreshList.Add(storylet);
            }
            return refreshList;
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

        // Parse an array of raw Ink tag strings into a key/value dictionary.
        //   #once            -> { "once": true }
        //   #desc: Some text -> { "desc": "Some text" }
        //   #loc: library    -> { "loc": "library" }
        // Tag names are lowercased. "true"/"false" string values become booleans.
        private static Dictionary<string, object> ParseTags(List<string> rawTags)
        {
            var result = new Dictionary<string, object>();
            if (rawTags == null) return result;
            foreach (string tag in rawTags)
            {
                int colonIdx = tag.IndexOf(':');
                if (colonIdx == -1)
                {
                    result[tag.Trim().ToLower()] = true;
                }
                else
                {
                    string k = tag.Substring(0, colonIdx).Trim().ToLower();
                    string v = tag.Substring(colonIdx + 1).Trim();
                    string vLower = v.ToLower();
                    if (vLower == "true") result[k] = true;
                    else if (vLower == "false") result[k] = false;
                    else result[k] = v;
                }
            }
            return result;
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
            internal string GroupPredicate; // null if no group predicate

            internal Storylet(string knotID)
            {
                this.knotID = knotID;
            }
        }
    }
}
