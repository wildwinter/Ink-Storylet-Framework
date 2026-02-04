import { Story } from 'inkjs';
import type { WorkerMessage, WorkerResponse } from './StoryletWorker';

declare var require: any;
declare var process: any;


export class StoryletManager {
    public onRefreshComplete: (() => void) | null = null;

    public get isReady(): boolean {
        return this._state === State.REFRESH_COMPLETE;
    }

    public get isRefreshing(): boolean {
        return this._state === State.REFRESHING;
    }

    public get needsRefresh(): boolean {
        return this._state === State.NEEDS_REFRESH;
    }

    private _story: Story;
    private _worker: any; // Node Worker type is dynamic
    private _hand: string[] = [];
    private _handWeighted: string[] = [];
    private _state: State = State.NEEDS_REFRESH;

    // We pass the RAW JSON content for the worker to initialize its own instance
    constructor(story: Story, storyContentJson: any, workerPath: string = './StoryletWorker.js') {
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
            // Simulate MessageEvent structure for our internal handler if needed, 
            // or just pass data directly and adjust handler. 
            // Our internal handler expects { data: ... }
            this.handleWorkerMessage({ data } as MessageEvent);
        });

        worker.on('error', (err: any) => console.error("Worker Error:", err));

        // Initialize worker immediately
        this.postMessage({
            type: 'INIT',
            storyContent: storyContentJson
        });
    }

    public addStorylets(prefix: string): void {
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

        console.log(`[StoryletManager] Discovered ${discovered.length} storylets:`, discovered);

        this.postMessage({
            type: 'REGISTER_STORYLETS',
            storylets: discovered
        });

        this._state = State.NEEDS_REFRESH;
    }

    /**
     * Start the async refresh.
     * This serializes the current main thread Ink state and sends it to the worker.
     */
    public refresh(): void {
        if (this._state === State.REFRESHING) return;

        this._state = State.REFRESHING;

        // Capture current state
        const stateJson = this._story.state.ToJson();

        this.postMessage({
            type: 'REFRESH',
            stateJson: stateJson
        });
    }

    public getPlayableStorylets(weighted: boolean = false): string[] | null {
        if (this._state !== State.REFRESH_COMPLETE) {
            console.error("Don't call getPlayableStorylets until refresh is complete!");
            return null;
        }

        if (!weighted) {
            return this._hand;
        }
        return this._handWeighted;
    }

    public markPlayed(knotID: string): void {
        // Fire and forget update to worker
        this.postMessage({ type: 'MARK_PLAYED', knotID });
    }

    public pickPlayableStorylet(): string | null {
        if (this._state !== State.REFRESH_COMPLETE) {
            console.error("Don't call pickPlayableStorylet until refresh is complete!");
            return null;
        }

        if (this._handWeighted.length === 0) {
            return null;
        }

        const i = Math.floor(Math.random() * this._handWeighted.length);
        const knotID = this._handWeighted[i];
        this.markPlayed(knotID);
        return knotID;
    }

    public reset(): void {
        this._hand = [];
        this._handWeighted = [];
        this._state = State.NEEDS_REFRESH;
        this.postMessage({ type: 'RESET' });
    }

    public saveAsJson(): Promise<string> {
        return new Promise((resolve) => {
            const tempHandler = (e: any) => {
                if (e.type === 'SAVE_DATABOLT') {
                    this._worker.off('message', tempHandler);
                    resolve(e.json);
                }
            };
            // Node worker listener needs adapting
            // The easier path:
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

    private postMessage(msg: WorkerMessage) {
        this._worker.postMessage(msg);
    }

    private handleWorkerMessage(event: MessageEvent<WorkerResponse>) {
        const msg = event.data;
        switch (msg.type) {
            case 'INIT_COMPLETE':
                // Worker is ready
                break;
            case 'REFRESH_COMPLETE':
                this._hand = msg.hand;
                this._handWeighted = msg.handWeighted;
                this._state = State.REFRESH_COMPLETE;
                if (this.onRefreshComplete) this.onRefreshComplete();
                break;
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

        console.log("[StoryletManager] All Knot IDs found:", knotList);
        return knotList;
    }
}

enum State {
    NEEDS_REFRESH,
    REFRESHING,
    REFRESH_COMPLETE
}
