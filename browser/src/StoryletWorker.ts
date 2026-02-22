import { Story } from 'inkjs';

// Define the shape of messages exchanged
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

// Internal class to hold storylet state
class Storylet {
    public knotID: string;
    public played: boolean = false;
    public once: boolean = false;
    public groupPredicate: string | null = null;

    constructor(knotID: string) {
        this.knotID = knotID;
    }
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

// --- Message Handling ---

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;

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
};

function postResponse(msg: WorkerResponse) {
    self.postMessage(msg);
}

// --- Logic ---

function handleInit(content: any) {
    story = new Story(content);
    pools.clear();
    postResponse({ type: 'INIT_COMPLETE' });
}

function handleRegisterStorylets(pool: string, list: { knotID: string; once: boolean; groupPredicate: string | null }[]) {
    const deck = getOrCreatePool(pool);

    for (const item of list) {
        const storylet = new Storylet(item.knotID);
        storylet.once = item.once;
        storylet.groupPredicate = item.groupPredicate;
        deck.set(item.knotID, storylet);
    }
}

function refreshPool(poolName: string, deck: Map<string, Storylet>, groupOverrides?: Record<string, boolean>): void {
    const hand: string[] = [];
    const handWeighted: string[] = [];

    for (const storylet of deck.values()) {
        // Group predicate results were evaluated on the main thread (where external functions
        // are bound) and passed in as groupOverrides. Skip storylets in inactive groups.
        const gp = storylet.groupPredicate;
        if (gp && groupOverrides) {
            const groupActive = groupOverrides[gp] ?? true;
            if (!groupActive) continue;
        }

        const weighting = getWeighting(story!, storylet);
        if (weighting > 0) {
            hand.push(storylet.knotID);
            for (let i = 0; i < weighting; i++) {
                handWeighted.push(storylet.knotID);
            }
        }
    }

    postResponse({ type: 'REFRESH_COMPLETE', pool: poolName, hand, handWeighted });
}

function handleRefresh(stateJson: string, pool?: string, groupOverrides?: Record<string, boolean>) {
    if (!story) {
        throw new Error("StoryletWorker not initialized.");
    }

    if (stateJson) {
        story.state.LoadJson(stateJson);
    }

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
    handleReset();
    // Format: Record<poolName, [knotID, played][]>
    const data: Record<string, [string, boolean][]> = JSON.parse(json);
    for (const [poolName, entries] of Object.entries(data)) {
        const deck = pools.get(poolName);
        if (deck) {
            for (const [knotID, played] of entries) {
                const s = deck.get(knotID);
                if (s) s.played = played;
            }
        }
    }
}

// --- Helpers ---

function getWeighting(story: Story, storylet: Storylet): number {
    if (storylet.played && storylet.once) {
        return 0;
    }

    let retVal;
    try {
        retVal = story.EvaluateFunction("_" + storylet.knotID);
    } catch (e) {
        return 0;
    }

    if (typeof retVal === 'boolean') {
        return retVal ? 1 : 0;
    }

    if (typeof retVal === 'number') {
        return Math.floor(retVal);
    }

    return 0;
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
