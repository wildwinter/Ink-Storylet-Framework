import { Story } from 'inkjs';
import type { WorkerMessage, WorkerResponse } from './StoryletWorker';

declare var require: any;
declare var process: any;

const DEFAULT_POOL = 'default';

interface PoolState {
    hand: string[];
    handWeighted: string[];
    state: State;
}

export class StoryletManager {
    /** Called once per pool each time that pool's refresh completes. */
    public onRefreshComplete: ((pool: string) => void) | null = null;

    private _story: Story;
    private _worker: any; // Node Worker type is dynamic
    private _pools: Map<string, PoolState> = new Map();

    // Tag cache: knotID -> { tagName -> value }
    private _storyletTags: Map<string, Record<string, any>> = new Map();

    // All group predicate function names registered across all addStorylets() calls.
    // These are evaluated on the main thread (where external Ink functions are bound)
    // and sent to the worker as groupOverrides during each refresh.
    private _groupPredicates: Set<string> = new Set();

    constructor(story: Story, workerPath: string = './StoryletWorker.js') {
        this._story = story;

        let Worker;
        try {
            Worker = require('worker_threads').Worker;
        } catch (e) {
            throw new Error("StoryletManager (Node): 'worker_threads' module not found. Ensure you are running in Node.js.");
        }

        const worker = new Worker(workerPath);
        this._worker = worker;

        // Node workers use .on('message'), not .onmessage
        worker.on('message', (data: any) => {
            this.handleWorkerMessage({ data } as MessageEvent);
        });

        worker.on('error', (err: any) => console.error("Worker Error:", err));

        this.postMessage({
            type: 'INIT',
            storyContent: story.ToJson()
        });

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
        if (groupPredicate) this._groupPredicates.add(groupPredicate);

        const discovered: { knotID: string; once: boolean; groupPredicate: string | null }[] = [];

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

            discovered.push({
                knotID,
                once: tags['once'] === true,
                groupPredicate
            });
        }

        console.log(`[StoryletManager] Discovered ${discovered.length} storylets for pool "${pool}" (name="${name}"):`, discovered.map(d => d.knotID));

        this.getOrCreatePoolState(pool);

        this.postMessage({
            type: 'REGISTER_STORYLETS',
            pool,
            storylets: discovered
        });
    }

    // --- Refresh ---

    /**
     * Refresh a specific pool, or all registered pools if no pool is specified.
     * Group predicates are evaluated here on the main thread (where external Ink functions
     * are bound), then the results are forwarded to the worker along with the story state.
     * onRefreshComplete fires once per pool as each finishes.
     */
    public refresh(pool?: string): void {
        const groupOverrides = this.evaluateGroupPredicates();
        const stateJson = this._story.state.ToJson();

        if (pool !== undefined) {
            const poolState = this.getOrCreatePoolState(pool);
            if (poolState.state === State.REFRESHING) return;
            poolState.state = State.REFRESHING;
            this.postMessage({ type: 'REFRESH', stateJson, pool, groupOverrides });
        } else {
            for (const poolState of this._pools.values()) {
                poolState.state = State.REFRESHING;
            }
            this.postMessage({ type: 'REFRESH', stateJson, groupOverrides });
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
     * Mark a storylet as played. If pool is omitted, the message is sent to all registered
     * pools — safe since the worker ignores unknown knotIDs.
     */
    public markPlayed(knotID: string, pool?: string): void {
        if (pool !== undefined) {
            this.postMessage({ type: 'MARK_PLAYED', pool, knotID });
        } else {
            for (const poolName of this._pools.keys()) {
                this.postMessage({ type: 'MARK_PLAYED', pool: poolName, knotID });
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
            if (poolState) {
                poolState.hand = [];
                poolState.handWeighted = [];
                poolState.state = State.NEEDS_REFRESH;
            }
        } else {
            for (const poolState of this._pools.values()) {
                poolState.hand = [];
                poolState.handWeighted = [];
                poolState.state = State.NEEDS_REFRESH;
            }
        }
        this.postMessage({ type: 'RESET', pool });
    }

    // --- Save / Load ---

    public saveAsJson(): Promise<string> {
        return new Promise((resolve) => {
            const nodeHandler = (data: any) => {
                if (data.type === 'SAVE_DATABOLT') {
                    this._worker.off('message', nodeHandler);
                    resolve(data.json);
                }
            };
            this._worker.on('message', nodeHandler);
            this._worker.postMessage({ type: 'SAVE_DATABOLT' });
        });
    }

    public loadFromJson(json: string): void {
        this.reset();
        this.postMessage({ type: 'LOAD_DATABOLT', json });
    }

    public terminate(): void {
        this._worker.terminate();
    }

    // --- Private ---

    private getOrCreatePoolState(pool: string): PoolState {
        if (!this._pools.has(pool)) {
            this._pools.set(pool, { hand: [], handWeighted: [], state: State.NEEDS_REFRESH });
        }
        return this._pools.get(pool)!;
    }

    private getPoolState(pool: string): PoolState {
        return this._pools.get(pool) ?? { hand: [], handWeighted: [], state: State.NEEDS_REFRESH };
    }

    private postMessage(msg: WorkerMessage) {
        this._worker.postMessage(msg);
    }

    private handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
        const msg = event.data;
        switch (msg.type) {
            case 'INIT_COMPLETE':
                break;
            case 'REFRESH_COMPLETE': {
                const poolState = this.getOrCreatePoolState(msg.pool);
                poolState.hand = msg.hand;
                poolState.handWeighted = msg.handWeighted;
                poolState.state = State.REFRESH_COMPLETE;
                if (this.onRefreshComplete) this.onRefreshComplete(msg.pool);
                break;
            }
            case 'ERROR':
                console.error("StoryletManager Worker Error:", msg.message);
                break;
        }
    }

    /**
     * Evaluate all registered group predicates on the main thread.
     * This is done here rather than in the worker so that Ink external functions
     * (e.g. get_map()) are available during evaluation.
     * EvaluateFunction() is non-destructive — it saves and restores story state internally.
     */
    private evaluateGroupPredicates(): Record<string, boolean> {
        const results: Record<string, boolean> = {};
        for (const gp of this._groupPredicates) {
            try {
                const retVal = this._story.EvaluateFunction(gp);
                if (typeof retVal === 'boolean') results[gp] = retVal;
                else if (typeof retVal === 'number') results[gp] = retVal > 0;
                else results[gp] = false;
            } catch (_e) {
                results[gp] = true; // Missing function → group always active
            }
        }
        return results;
    }

    /**
     * Parse #storylets: global tags and call addStorylets() for each.
     * Tag format: #storylets:name  or  #storylets:name,poolName
     * The bare name (without trailing underscore) is passed; the underscore is inferred.
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
            // Check if it's a Map (inkjs > 2.0 uses Map)
            // @ts-ignore
            if (namedContent instanceof Map || (typeof namedContent.keys === 'function' && typeof namedContent.get === 'function')) {
                // @ts-ignore
                for (const name of namedContent.keys()) {
                    if (name === "global decl") continue;
                    knotList.push(name);
                }
            } else {
                // Assume Object (old versions)
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
