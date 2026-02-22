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

    constructor(story: Story, workerPath: string = './StoryletWorker.js') {
        this._story = story;

        // Node.js environment - Strict dependency on worker_threads
        // We use dynamic require to avoid bundling issues if this file is looked at by a browser bundler,
        // but arguably for a 'node' folder we could just import.
        // Let's stick to strict require for safety.

        let Worker;
        try {
            Worker = require('worker_threads').Worker;
        } catch (e) {
            throw new Error("StoryletManager (Node): 'worker_threads' module not found. Ensure you are running in Node.js.");
        }

        const worker = new Worker(workerPath);

        // We'll treat _worker as the Node Worker type, but cast to any to avoid complex typings for now.
        this._worker = worker;

        // Node workers use .on('message'), not .onmessage
        worker.on('message', (data: any) => {
            this.handleWorkerMessage({ data } as MessageEvent);
        });

        worker.on('error', (err: any) => console.error("Worker Error:", err));

        // Initialize worker with the story content extracted from the Story instance.
        // The worker runs on a separate thread and cannot share the Story object directly,
        // so it uses this JSON to construct its own instance.
        this.postMessage({
            type: 'INIT',
            storyContent: story.ToJson()
        });
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
     * Scan for storylets matching `prefix` and register them into `pool`.
     * Defaults to the 'default' pool.
     */
    public addStorylets(prefix: string, pool: string = DEFAULT_POOL): void {
        const discovered: { knotID: string; once: boolean; }[] = [];
        const knotIDs = this.getAllKnotIDs();

        for (const knotID of knotIDs) {
            if (knotID.startsWith(prefix)) {
                // Using a _ as a prefix for the function
                const functionName = "_" + knotID;
                if (!knotIDs.includes(functionName)) {
                    console.error(`Can't find test function ${functionName} for storylet ${knotID}.`);
                    continue;
                }

                // Check tags
                let once = false;
                // TagsForContentAtPath in inkjs is usually camelCase 'tagsForContentAtPath' in modern versions,
                // but might be PascalCase in older ones.
                // @ts-ignore
                const tags = (this._story.TagsForContentAtPath) ? this._story.TagsForContentAtPath(knotID) : this._story.tagsForContentAtPath(knotID);

                if (tags) {
                    // Check for case-insensitive 'once'
                    if (tags.some((t: string) => t.toLowerCase() === "once")) {
                        once = true;
                    }
                }

                discovered.push({ knotID, once });
            }
        }

        console.log(`[StoryletManager] Discovered ${discovered.length} storylets for pool "${pool}":`, discovered);

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
     * Serializes the current Ink state and sends it to the worker.
     * onRefreshComplete fires once per pool as each finishes.
     */
    public refresh(pool?: string): void {
        const stateJson = this._story.state.ToJson();

        if (pool !== undefined) {
            const poolState = this.getOrCreatePoolState(pool);
            if (poolState.state === State.REFRESHING) return;
            poolState.state = State.REFRESHING;
            this.postMessage({ type: 'REFRESH', stateJson, pool });
        } else {
            // Mark all known pools as refreshing and send a single message
            for (const poolState of this._pools.values()) {
                poolState.state = State.REFRESHING;
            }
            this.postMessage({ type: 'REFRESH', stateJson });
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

    /** Mark a storylet as played in the given pool (default: 'default'). */
    public markPlayed(knotID: string, pool: string = DEFAULT_POOL): void {
        this.postMessage({ type: 'MARK_PLAYED', pool, knotID });
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

        //console.log("[StoryletManager] All Knot IDs found:", knotList);
        return knotList;
    }
}

enum State {
    NEEDS_REFRESH,
    REFRESHING,
    REFRESH_COMPLETE
}
