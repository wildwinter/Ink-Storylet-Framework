import { Story } from 'inkjs';

// Define the shape of messages exchanged
export type WorkerMessage =
    | { type: 'INIT', storyContent: any }
    | { type: 'REGISTER_STORYLETS', storylets: { knotID: string; once: boolean; }[] }
    | { type: 'REFRESH', stateJson: string }
    | { type: 'MARK_PLAYED', knotID: string }
    | { type: 'RESET' }
    | { type: 'LOAD_DATABOLT', json: string }; // Custom load for the manager state

export type WorkerResponse =
    | { type: 'ERROR', message: string }
    | { type: 'INIT_COMPLETE' }
    | { type: 'REFRESH_COMPLETE', hand: string[], handWeighted: string[] }
    | { type: 'SAVE_DATABOLT', json: string };

// Internal class to hold storylet state
class Storylet {
    public knotID: string;
    public played: boolean = false;
    public once: boolean = false;

    constructor(knotID: string) {
        this.knotID = knotID;
    }
}

let story: Story | null = null;
let deck: Map<string, Storylet> = new Map();

// --- Message Handling ---

self.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const msg = event.data;

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
    // deck.clear(); // internal deck persists across story re-inits? No, probably should clear.
    deck.clear();
    postResponse({ type: 'INIT_COMPLETE' });
}

function handleRegisterStorylets(list: { knotID: string; once: boolean; }[]) {
    // Need robust access to check functions
    // @ts-ignore
    const mainContentContainer = story.mainContentContainer || story._mainContentContainer;
    // @ts-ignore
    const namedContent = mainContentContainer ? (mainContentContainer.namedOnlyContent || mainContentContainer.namedContent) : null;

    if (!namedContent) {
        console.error("Worker: Could not access namedContent to verify storylet functions.");
        // We might want to proceed blindly or return error. 
        // Proceeding blindly is risky if function doesn't exist.
    }

    for (const item of list) {
        // Just verify the function exists in our local story copy to be safe
        const functionName = "_" + item.knotID;

        // If we found namedContent, check it.
        if (namedContent) {
            let exists = false;
            // @ts-ignore
            if (namedContent instanceof Map || (typeof namedContent.get === 'function')) {
                // @ts-ignore
                exists = !!namedContent.get(functionName);
            } else {
                // @ts-ignore
                exists = !!namedContent[functionName];
            }

            if (!exists) {
                console.error(`Worker: Can't find test function ${functionName} for storylet ${item.knotID}.`);
                continue;
            }
        }

        const storylet = new Storylet(item.knotID);
        storylet.once = item.once;
        deck.set(item.knotID, storylet);
    }
}

function handleRefresh(stateJson: string) {
    if (!story) {
        throw new Error("StoryletWorker not initialized.");
    }

    // Sync state
    if (stateJson) {
        story.state.LoadJson(stateJson);
    }

    const hand: string[] = [];
    const handWeighted: string[] = [];

    // Process all storylets at once (async from main thread perspective)
    for (const storylet of deck.values()) {
        const weighting = getWeighting(story, storylet);
        if (weighting > 0) {
            hand.push(storylet.knotID);
            for (let i = 0; i < weighting; i++) {
                handWeighted.push(storylet.knotID);
            }
        }
    }

    postResponse({ type: 'REFRESH_COMPLETE', hand, handWeighted });
}

function handleMarkPlayed(knotID: string) {
    const s = deck.get(knotID);
    if (s) s.played = true;
}

function handleReset() {
    for (const s of deck.values()) {
        s.played = false;
    }
    // We don't clear the deck, just the play state
}

function handleLoad(json: string) {
    handleReset();
    const data = JSON.parse(json) as [string, boolean][];
    for (const [knotID, played] of data) {
        const s = deck.get(knotID);
        if (s) s.played = played;
    }
}

// --- Helpers ---

function getWeighting(story: Story, storylet: Storylet): number {
    if (storylet.played && storylet.once) {
        return 0;
    }

    // Evaluate function in the forked story instance
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

function getAllKnotIDs(story: Story): string[] {
    const knotList: string[] = [];
    // @ts-ignore
    const mainContentContainer = story.mainContentContainer || story._mainContentContainer;

    if (!mainContentContainer) return knotList;

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
    }

    return knotList;
}

// If we want to support saving, we also need a handler for requesting save data.
// But the original request didn't explicitly ask for save support in the worker, 
// though the original class had SaveAsJson. 
// I'll add a listener for it if needed, but for now I've implemented LOAD.
// Let's add SAVE support to be complete.
self.addEventListener('message', (event) => {
    if (event.data.type === 'SAVE_DATABOLT') {
        const data: [string, boolean][] = [];
        for (const s of deck.values()) {
            data.push([s.knotID, s.played]);
        }
        postResponse({ type: 'SAVE_DATABOLT', json: JSON.stringify(data) });
    }
});
