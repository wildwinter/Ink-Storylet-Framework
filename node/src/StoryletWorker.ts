import { Story } from 'inkjs';

declare var require: any;


// --- Types ---

export type WorkerMessage =
    | { type: 'INIT', storyContent: any }
    | { type: 'REGISTER_STORYLETS', pool: string, storylets: { knotID: string; once: boolean; groupPredicate: string | null }[] }
    | { type: 'REFRESH', stateJson: string, pool?: string, groupOverrides?: Record<string, boolean> }
    | { type: 'MARK_PLAYED', pool: string, knotID: string }
    | { type: 'RESET', pool?: string }                       // pool undefined = all pools
    | { type: 'LOAD_DATABOLT', json: string }
    | { type: 'SAVE_DATABOLT' };


export type WorkerResponse =
    | { type: 'ERROR', message: string }
    | { type: 'INIT_COMPLETE' }
    | { type: 'REFRESH_COMPLETE', pool: string, hand: string[], handWeighted: string[] }
    | { type: 'SAVE_DATABOLT', json: string };


// --- Node.js Worker Handling ---
let parentPort: any;

try {
    parentPort = require('worker_threads').parentPort;
} catch (e) {
    console.error("StoryletWorker (Node): Failed to load worker_threads.");
}

if (parentPort) {
    parentPort.on('message', (msg: WorkerMessage) => {
        handleMessage(msg);
    });
} else {
    console.error("StoryletWorker (Node): No parentPort found.");
}

function handleMessage(msg: WorkerMessage) {
    try {
        switch (msg.type) {
            case 'INIT':
                handleInit(msg.storyContent);
                break;
            case 'REGISTER_STORYLETS':
                handleRegisterStorylets(msg.pool, msg.storylets);
                break;
            case 'REFRESH':
                handleRefresh(msg.stateJson, msg.pool, msg.groupOverrides);
                break;
            case 'MARK_PLAYED':
                handleMarkPlayed(msg.pool, msg.knotID);
                break;
            case 'RESET':
                handleReset(msg.pool);
                break;
            case 'LOAD_DATABOLT':
                handleLoad(msg.json);
                break;
            case 'SAVE_DATABOLT':
                handleSave();
                break;
        }
    } catch (err: any) {
        postResponse({ type: 'ERROR', message: err.message || 'Unknown worker error' });
    }
}

function postResponse(msg: WorkerResponse) {
    if (parentPort) {
        parentPort.postMessage(msg);
    }
}

// --- Logic ---

interface Storylet {
    knotID: string;
    once: boolean;
    played: boolean;
    groupPredicate: string | null;
}

let story: Story | null = null;

// pools: pool name -> (knotID -> Storylet)
const pools: Map<string, Map<string, Storylet>> = new Map();

function getOrCreatePool(pool: string): Map<string, Storylet> {
    if (!pools.has(pool)) {
        pools.set(pool, new Map());
    }
    return pools.get(pool)!;
}

function handleInit(storyContent: any) {
    story = new Story(storyContent);
    postResponse({ type: 'INIT_COMPLETE' });
}

function handleRegisterStorylets(pool: string, storylets: { knotID: string; once: boolean; groupPredicate: string | null }[]) {
    const deck = getOrCreatePool(pool);
    for (const s of storylets) {
        if (!deck.has(s.knotID)) {
            deck.set(s.knotID, {
                knotID: s.knotID,
                once: s.once,
                played: false,
                groupPredicate: s.groupPredicate
            });
        }
    }
}

function refreshPool(poolName: string, deck: Map<string, Storylet>, groupOverrides?: Record<string, boolean>): void {
    const hand: string[] = [];
    const handWeighted: string[] = [];

    for (const s of deck.values()) {
        // Group predicate results were evaluated on the main thread (where external functions
        // are bound) and passed in as groupOverrides. Skip storylets in inactive groups.
        const gp = s.groupPredicate;
        if (gp && groupOverrides) {
            const groupActive = groupOverrides[gp] ?? true;
            if (!groupActive) continue;
        }

        if (s.once && s.played) continue;

        const funcName = "_" + s.knotID;
        let result = story!.EvaluateFunction(funcName);

        let weight = 0;
        if (typeof result === 'boolean') {
            weight = result ? 1 : 0;
        } else if (typeof result === 'number') {
            weight = result;
        }

        if (weight > 0) {
            hand.push(s.knotID);
            for (let i = 0; i < weight; i++) {
                handWeighted.push(s.knotID);
            }
        }
    }

    postResponse({ type: 'REFRESH_COMPLETE', pool: poolName, hand, handWeighted });
}

function handleRefresh(stateJson: string, pool?: string, groupOverrides?: Record<string, boolean>) {
    if (!story) throw new Error("Worker not initialized with story content.");

    story.state.LoadJson(stateJson);

    if (pool !== undefined) {
        refreshPool(pool, getOrCreatePool(pool), groupOverrides);
    } else {
        for (const [poolName, deck] of pools) {
            refreshPool(poolName, deck, groupOverrides);
        }
    }
}

function handleMarkPlayed(pool: string, knotID: string) {
    const deck = pools.get(pool);
    if (deck) {
        const s = deck.get(knotID);
        if (s) s.played = true;
    }
}

function handleReset(pool?: string) {
    if (pool !== undefined) {
        const deck = pools.get(pool);
        if (deck) {
            for (const s of deck.values()) s.played = false;
        }
    } else {
        for (const deck of pools.values()) {
            for (const s of deck.values()) s.played = false;
        }
    }
}

function handleLoad(json: string) {
    try {
        // Format: Record<poolName, [knotID, played][]>
        const data: Record<string, [string, boolean][]> = JSON.parse(json);
        for (const [poolName, entries] of Object.entries(data)) {
            const deck = pools.get(poolName);
            if (deck) {
                for (const [id, played] of entries) {
                    const s = deck.get(id);
                    if (s) s.played = played;
                }
            }
        }
    } catch (e) {
        console.error("Failed to load databolt json in worker", e);
    }
}

function handleSave() {
    // Format: Record<poolName, [knotID, played][]>
    const data: Record<string, [string, boolean][]> = {};
    for (const [poolName, deck] of pools) {
        data[poolName] = [];
        for (const s of deck.values()) {
            data[poolName].push([s.knotID, s.played]);
        }
    }
    postResponse({ type: 'SAVE_DATABOLT', json: JSON.stringify(data) });
}
