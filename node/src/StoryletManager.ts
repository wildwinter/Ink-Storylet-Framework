import { Story } from 'inkjs';

declare var require: any;

const DEFAULT_POOL = 'default';

interface PoolState {
    deck: Map<string, Storylet>;
    refreshList: Storylet[];
    hand: string[];
    handWeighted: string[];
    state: State;
}

class Storylet {
    public knotID: string;
    public played: boolean = false;
    public once: boolean = false;
    public groupPredicate: string | null = null;

    constructor(knotID: string) {
        this.knotID = knotID;
    }
}

export class StoryletManager {
    /** Called once per pool each time that pool's refresh completes. */
    public onRefreshComplete: ((pool: string) => void) | null = null;

    /**
     * Number of storylet predicates evaluated per tick() call, per refreshing pool.
     * Raise for faster completion; lower for smoother event-loop budgets.
     * Default: 5.
     */
    public storyletsPerTick: number = 5;

    private _story: Story;
    private _pools: Map<string, PoolState> = new Map();

    // Tag cache: knotID -> { tagName -> value }
    private _storyletTags: Map<string, Record<string, any>> = new Map();

    constructor(story: Story) {
        this._story = story;
        this.addStoryletsFromGlobalTags();
    }

    // --- State accessors ---

    /** Returns true if the given pool (default: 'default') has a completed refresh. */
    public isReady(pool: string = DEFAULT_POOL): boolean {
        return this.getPoolState(pool).state === State.REFRESH_COMPLETE;
    }

    /** Returns true if the given pool (default: 'default') is currently refreshing. */
    public isRefreshing(pool: string = DEFAULT_POOL): boolean {
        return this.getPoolState(pool).state === State.REFRESHING;
    }

    /** Returns true if the given pool (default: 'default') needs a refresh. */
    public needsRefresh(pool: string = DEFAULT_POOL): boolean {
        return this.getPoolState(pool).state === State.NEEDS_REFRESH;
    }

    /** Returns true if every registered pool has a completed refresh. */
    public areAllReady(): boolean {
        if (this._pools.size === 0) return false;
        for (const poolState of this._pools.values()) {
            if (poolState.state !== State.REFRESH_COMPLETE) return false;
        }
        return true;
    }

    // --- Storylet registration ---

    /**
     * Discover storylets whose knot names start with `name_` and register them into `pool`.
     *
     * The underscore is inferred: addStorylets("encounters") finds all knots beginning with
     * "encounters_" and uses "_encounters()" as an optional group predicate.
     *
     * If an Ink function named `_<name>()` exists it is evaluated as a group gate on every
     * refresh — if it returns false the entire group is skipped without checking individual
     * storylet predicates. This is useful for location- or state-dependent pools (e.g. the
     * group is only active when the player is in a certain area).
     *
     * Defaults to the 'default' pool.
     */
    public addStorylets(name: string, pool: string = DEFAULT_POOL): void {
        const prefix = name + '_';
        const knotIDs = this.getAllKnotIDs();

        // Determine group predicate (optional — only used if the function exists)
        const groupPredFn = '_' + name;
        const groupPredicate = knotIDs.includes(groupPredFn) ? groupPredFn : null;

        const poolState = this.getOrCreatePoolState(pool);
        const discovered: string[] = [];

        for (const knotID of knotIDs) {
            if (!knotID.startsWith(prefix)) continue;

            // Each storylet must have a matching predicate function _knotID()
            const functionName = '_' + knotID;
            if (!knotIDs.includes(functionName)) {
                console.error(`Can't find predicate function ${functionName} for storylet ${knotID}.`);
                continue;
            }

            // Read and cache all tags for this storylet
            // @ts-ignore
            const rawTags: string[] | null = (this._story.TagsForContentAtPath)
                ? this._story.TagsForContentAtPath(knotID)
                : this._story.tagsForContentAtPath(knotID);

            const tags = parseTags(rawTags ?? []);
            this._storyletTags.set(knotID, tags);

            const storylet = new Storylet(knotID);
            storylet.once = tags['once'] === true;
            storylet.groupPredicate = groupPredicate;
            poolState.deck.set(knotID, storylet);
            discovered.push(knotID);
        }

        console.log(`[StoryletManager] Discovered ${discovered.length} storylets for pool "${pool}" (name="${name}"):`, discovered);
    }

    // --- Refresh ---

    /**
     * Start a refresh for a specific pool, or all registered pools if none specified.
     * Builds the refresh list synchronously (group predicates evaluated here, where
     * external Ink functions are bound), then sets state to REFRESHING.
     * Call tick() regularly to process the list. onRefreshComplete fires per pool.
     */
    public refresh(pool?: string): void {
        if (pool !== undefined) {
            const poolState = this.getOrCreatePoolState(pool);
            if (poolState.state === State.REFRESHING) return;
            poolState.hand = [];
            poolState.handWeighted = [];
            poolState.refreshList = this.buildRefreshList(poolState);
            poolState.state = State.REFRESHING;
        } else {
            for (const poolState of this._pools.values()) {
                poolState.hand = [];
                poolState.handWeighted = [];
                poolState.refreshList = this.buildRefreshList(poolState);
                poolState.state = State.REFRESHING;
            }
        }
    }

    /**
     * Process up to storyletsPerTick items per refreshing pool.
     * Must be called regularly after refresh().
     * Fires onRefreshComplete once per pool when that pool's list is exhausted.
     */
    public tick(): void {
        for (const [poolName, poolState] of this._pools) {
            if (poolState.state !== State.REFRESHING) continue;

            const count = Math.min(this.storyletsPerTick, poolState.refreshList.length);
            for (let i = 0; i < count; i++) {
                const storylet = poolState.refreshList.shift()!;
                const w = this.getWeighting(storylet);
                if (w > 0) {
                    poolState.hand.push(storylet.knotID);
                    for (let j = 0; j < w; j++) poolState.handWeighted.push(storylet.knotID);
                }
            }

            if (poolState.refreshList.length === 0) {
                poolState.state = State.REFRESH_COMPLETE;
                if (this.onRefreshComplete) this.onRefreshComplete(poolName);
            }
        }
    }

    // --- Query ---

    /**
     * Returns the playable storylets for the given pool (default: 'default').
     * Returns null if that pool's refresh is not yet complete.
     */
    public getPlayableStorylets(weighted: boolean = false, pool: string = DEFAULT_POOL): string[] | null {
        const poolState = this._pools.get(pool);
        if (!poolState || poolState.state !== State.REFRESH_COMPLETE) {
            console.error(`Don't call getPlayableStorylets until refresh is complete for pool "${pool}"!`);
            return null;
        }
        return weighted ? poolState.handWeighted : poolState.hand;
    }

    /**
     * Picks a random playable storylet from the given pool (default: 'default'),
     * weighted by predicate return values, and marks it as played.
     * Returns null if the pool is not ready or has no playable storylets.
     */
    public pickPlayableStorylet(pool: string = DEFAULT_POOL): string | null {
        const poolState = this._pools.get(pool);
        if (!poolState || poolState.state !== State.REFRESH_COMPLETE) {
            console.error(`Don't call pickPlayableStorylet until refresh is complete for pool "${pool}"!`);
            return null;
        }

        if (poolState.handWeighted.length === 0) return null;

        const i = Math.floor(Math.random() * poolState.handWeighted.length);
        const knotID = poolState.handWeighted[i];
        this.markPlayed(knotID, pool);
        return knotID;
    }

    /**
     * Mark a storylet as played. If pool is omitted, all pools are searched
     * (safe — unknown knotIDs are silently ignored).
     */
    public markPlayed(knotID: string, pool?: string): void {
        if (pool !== undefined) {
            const poolState = this._pools.get(pool);
            if (poolState) {
                const s = poolState.deck.get(knotID);
                if (s) s.played = true;
            }
        } else {
            for (const poolState of this._pools.values()) {
                const s = poolState.deck.get(knotID);
                if (s) s.played = true;
            }
        }
    }

    // --- Tag queries ---

    /**
     * Returns the value of a named tag on a storylet knot, or defaultValue if absent.
     * Tag names are case-insensitive. Values are parsed at registration time:
     *   - "true"/"false" strings become booleans
     *   - bare tags (no colon) become true
     *   - everything else is returned as a trimmed string
     */
    public getStoryletTag(knotID: string, tagName: string, defaultValue: any = null): any {
        const tags = this._storyletTags.get(knotID);
        if (!tags) return defaultValue;
        const key = tagName.toLowerCase();
        return key in tags ? tags[key] : defaultValue;
    }

    /**
     * Returns all playable storylets whose tag `tagName` equals `tagValue`.
     * If `pool` is provided only that pool is searched; otherwise all pools are searched.
     */
    public getPlayableStoryletsWithTag(tagName: string, tagValue: any, pool?: string): string[] {
        const poolNames = pool !== undefined ? [pool] : Array.from(this._pools.keys());
        const result: string[] = [];
        const key = tagName.toLowerCase();

        for (const p of poolNames) {
            const poolState = this._pools.get(p);
            if (!poolState || poolState.state !== State.REFRESH_COMPLETE) continue;
            for (const knotID of poolState.hand) {
                const tags = this._storyletTags.get(knotID);
                if (tags && tags[key] === tagValue) {
                    result.push(knotID);
                }
            }
        }
        return result;
    }

    /**
     * Returns the first playable storylet whose tag `tagName` equals `tagValue`, or null.
     * If `pool` is provided only that pool is searched; otherwise all pools are searched.
     */
    public getFirstPlayableStoryletWithTag(tagName: string, tagValue: any, pool?: string): string | null {
        const matches = this.getPlayableStoryletsWithTag(tagName, tagValue, pool);
        return matches.length > 0 ? matches[0] : null;
    }

    // --- Reset ---

    /**
     * Reset played state for a specific pool, or all pools if none specified.
     * The pool's hand is cleared and state returns to NEEDS_REFRESH.
     */
    public reset(pool?: string): void {
        if (pool !== undefined) {
            const poolState = this._pools.get(pool);
            if (poolState) resetPoolState(poolState);
        } else {
            for (const poolState of this._pools.values()) {
                resetPoolState(poolState);
            }
        }
    }

    // --- Save / Load ---

    /**
     * Returns a JSON string encoding the played state of all pools.
     * Format: { "poolName": [["knotID", played], ...], ... }
     * Save the Ink story state separately via story.state.ToJson().
     */
    public saveAsJson(): string {
        const data: Record<string, [string, boolean][]> = {};
        for (const [poolName, poolState] of this._pools) {
            data[poolName] = [];
            for (const s of poolState.deck.values()) {
                data[poolName].push([s.knotID, s.played]);
            }
        }
        return JSON.stringify(data);
    }

    /** Restore played state from a saveAsJson() string. */
    public loadFromJson(json: string): void {
        this.reset();
        const data: Record<string, [string, boolean][]> = JSON.parse(json);
        for (const [poolName, entries] of Object.entries(data)) {
            const poolState = this._pools.get(poolName);
            if (poolState) {
                for (const [knotID, played] of entries) {
                    const s = poolState.deck.get(knotID);
                    if (s) s.played = played;
                }
            }
        }
    }

    // --- Private ---

    private getOrCreatePoolState(pool: string): PoolState {
        if (!this._pools.has(pool)) {
            this._pools.set(pool, {
                deck: new Map(),
                refreshList: [],
                hand: [],
                handWeighted: [],
                state: State.NEEDS_REFRESH
            });
        }
        return this._pools.get(pool)!;
    }

    private getPoolState(pool: string): PoolState {
        return this._pools.get(pool) ?? {
            deck: new Map(),
            refreshList: [],
            hand: [],
            handWeighted: [],
            state: State.NEEDS_REFRESH
        };
    }

    /**
     * Evaluate group predicates (on the main thread, where external functions are bound),
     * then return the subset of the pool's deck that should be evaluated this refresh.
     */
    private buildRefreshList(poolState: PoolState): Storylet[] {
        const groupResults: Record<string, boolean> = {};
        for (const storylet of poolState.deck.values()) {
            const gp = storylet.groupPredicate;
            if (gp && !(gp in groupResults)) {
                let active = true;
                try {
                    const retVal = this._story.EvaluateFunction(gp);
                    if (typeof retVal === 'boolean') active = retVal;
                    else if (typeof retVal === 'number') active = retVal > 0;
                } catch (_e) {
                    active = true; // Missing function → group always active
                }
                groupResults[gp] = active;
            }
        }

        const list: Storylet[] = [];
        for (const storylet of poolState.deck.values()) {
            const gp = storylet.groupPredicate;
            if (gp && gp in groupResults && !groupResults[gp]) continue;
            list.push(storylet);
        }
        return list;
    }

    private getWeighting(storylet: Storylet): number {
        if (storylet.played && storylet.once) return 0;

        let retVal;
        try {
            retVal = this._story.EvaluateFunction('_' + storylet.knotID);
        } catch (_e) {
            return 0;
        }

        if (typeof retVal === 'boolean') return retVal ? 1 : 0;
        if (typeof retVal === 'number') return Math.floor(retVal);
        return 0;
    }

    /**
     * Parse #storylets: global tags and call addStorylets() for each.
     * Tag format: #storylets:name  or  #storylets:name,poolName
     */
    private addStoryletsFromGlobalTags(): void {
        const tags = this._story.globalTags;
        if (!tags) return;
        for (const tag of tags) {
            if (!tag.startsWith('storylets:')) continue;
            const parts = tag.slice('storylets:'.length).split(',');
            const name = parts[0].trim();
            const pool = parts.length > 1 ? parts[1].trim() : DEFAULT_POOL;
            if (name) this.addStorylets(name, pool);
        }
    }

    private getAllKnotIDs(): string[] {
        const knotList: string[] = [];
        // @ts-ignore
        const mainContentContainer = this._story.mainContentContainer || this._story._mainContentContainer;

        if (!mainContentContainer) {
            console.warn("[StoryletManager] Could not find mainContentContainer");
            return knotList;
        }

        // @ts-ignore
        const namedContent = mainContentContainer.namedOnlyContent || mainContentContainer.namedContent;

        if (namedContent) {
            // @ts-ignore
            if (namedContent instanceof Map || (typeof namedContent.keys === 'function' && typeof namedContent.get === 'function')) {
                // @ts-ignore
                for (const name of namedContent.keys()) {
                    if (name === "global decl") continue;
                    knotList.push(name);
                }
            } else {
                for (const name of Object.keys(namedContent)) {
                    if (name === "global decl") continue;
                    knotList.push(name);
                }
            }
        } else {
            console.warn("[StoryletManager] Could not find namedContent");
        }

        return knotList;
    }
}

enum State {
    NEEDS_REFRESH,
    REFRESHING,
    REFRESH_COMPLETE
}

function resetPoolState(poolState: PoolState): void {
    for (const s of poolState.deck.values()) s.played = false;
    poolState.refreshList = [];
    poolState.hand = [];
    poolState.handWeighted = [];
    poolState.state = State.NEEDS_REFRESH;
}

/**
 * Parse an array of raw Ink tag strings into a key/value map.
 *   #once            → { once: true }
 *   #desc: Some text → { desc: "Some text" }
 *   #loc: library    → { loc: "library" }
 * Tag names are lowercased. "true"/"false" string values become booleans.
 */
function parseTags(rawTags: string[]): Record<string, any> {
    const result: Record<string, any> = {};
    for (const tag of rawTags) {
        const colonIdx = tag.indexOf(':');
        if (colonIdx === -1) {
            result[tag.trim().toLowerCase()] = true;
        } else {
            const key = tag.slice(0, colonIdx).trim().toLowerCase();
            const raw = tag.slice(colonIdx + 1).trim();
            const lower = raw.toLowerCase();
            if (lower === 'true') result[key] = true;
            else if (lower === 'false') result[key] = false;
            else result[key] = raw;
        }
    }
    return result;
}
