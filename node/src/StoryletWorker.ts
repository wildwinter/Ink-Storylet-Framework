import { Story } from 'inkjs';

declare var require: any;


// --- Types ---

export type WorkerMessage =
    | { type: 'INIT', storyContent: any }
    | { type: 'REGISTER_STORYLETS', storylets: { knotID: string; once: boolean }[] }
    | { type: 'REFRESH', stateJson: string }
    | { type: 'MARK_PLAYED', knotID: string }
    | { type: 'RESET' }
    | { type: 'LOAD_DATABOLT', json: string } // Custom load for the manager state
    | { type: 'SAVE_DATABOLT' };


export type WorkerResponse =
    | { type: 'ERROR', message: string }
    | { type: 'INIT_COMPLETE' }
    | { type: 'REFRESH_COMPLETE', hand: string[], handWeighted: string[] }
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
    // Should not happen if launched correctly
    console.error("StoryletWorker (Node): No parentPort found.");
}

function handleMessage(msg: WorkerMessage) {
    try {
        switch (msg.type) {
            case 'INIT':
                handleInit(msg.storyContent);
                break;
            case 'REGISTER_STORYLETS':
                handleRegisterStorylets(msg.storylets);
                break;
            case 'REFRESH':
                handleRefresh(msg.stateJson);
                break;
            case 'MARK_PLAYED':
                handleMarkPlayed(msg.knotID);
                break;
            case 'RESET':
                handleReset();
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

// --- Logic (Identical to Browser, but encapsulated) ---

interface Storylet {
    knotID: string;
    once: boolean;
    played: boolean;
}

let story: Story | null = null;
const deck: Map<string, Storylet> = new Map();

function handleInit(storyContent: any) {
    story = new Story(storyContent);
    postResponse({ type: 'INIT_COMPLETE' });
}

function handleRegisterStorylets(storylets: { knotID: string; once: boolean }[]) {
    for (const s of storylets) {
        if (!deck.has(s.knotID)) {
            deck.set(s.knotID, {
                knotID: s.knotID,
                once: s.once,
                played: false
            });
        }
    }
    // No response needed, just internal update
}

function handleRefresh(stateJson: string) {
    if (!story) throw new Error("Worker not initialized with story content.");

    story.state.LoadJson(stateJson);

    const hand: string[] = [];
    const handWeighted: string[] = [];

    // Evaluate predicates
    for (const s of deck.values()) {
        // If 'once' and played, skip
        if (s.once && s.played) continue;

        const funcName = "_" + s.knotID;
        // Evaluatefunction in inkjs might throw if function doesn't exist, 
        // effectively handled by try-catch in onmessage

        let result = story.EvaluateFunction(funcName);

        // result is the return value of the function
        // It could be boolean or int/float

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

    postResponse({
        type: 'REFRESH_COMPLETE',
        hand,
        handWeighted
    });
}

function handleMarkPlayed(knotID: string) {
    const s = deck.get(knotID);
    if (s) {
        s.played = true;
    }
}

function handleReset() {
    for (const s of deck.values()) {
        s.played = false;
    }
}

function handleLoad(json: string) {
    try {
        const data: [string, boolean][] = JSON.parse(json);
        // data is [[knotID, played], ...]
        for (const [id, played] of data) {
            const s = deck.get(id);
            if (s) {
                s.played = played;
            }
        }
    } catch (e) {
        console.error("Failed to load databolt json in worker", e);
    }
}

function handleSave() {
    const data: [string, boolean][] = [];
    for (const s of deck.values()) {
        data.push([s.knotID, s.played]);
    }
    postResponse({ type: 'SAVE_DATABOLT', json: JSON.stringify(data) });
}
