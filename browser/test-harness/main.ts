import { Story } from 'inkjs';
import { StoryletManager } from '../src/StoryletManager';
import { runUntilReady } from '../src/StoryletRunner';
import storyContent from '../../tests/test1/test.ink.json';

const logEl = document.getElementById('log')!;
const statusEl = document.getElementById('status')!;
const storyTextEl = document.getElementById('story-text')!;
const storyChoicesEl = document.getElementById('story-choices')!;

function log(msg: string, type: 'info' | 'error' | 'success' = 'info') {
    const d = document.createElement('div');
    d.className = `log-entry ${type}`;
    d.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.prepend(d);
    console.log(msg);
}

let manager: StoryletManager | null = null;
// @ts-ignore
const story = new Story(storyContent);

function init() {
    try {
        log('Initializing StoryletManager...', 'info');

        manager = new StoryletManager(story);

        // onRefreshComplete now receives the pool name that just finished refreshing.
        manager.onRefreshComplete = (pool: string) => {
            log(`Refresh Complete for pool "${pool}"! Playable storylets available.`, 'success');
            // Only update the UI once all registered pools are ready.
            if (manager!.areAllReady()) {
                statusEl.textContent = 'Status: Ready';
                updatePlayableList();
            }
        };

        // Test addStorylets
        //log('Scanning and adding storylets with prefix "story_" into the default pool...', 'info');
        //manager.addStorylets("story_");
        // Example of adding a second pool — uncomment and add matching knots to your ink file:
        // manager.addStorylets("encounter_", "encounters");

        log('Manager initialized. Refreshing all pools...', 'success');
        statusEl.textContent = 'Status: Initialized';
        manager.refresh();
        runUntilReady(manager);

    } catch (e: any) {
        log(`Error: ${e.message}`, 'error');
    }
}

document.getElementById('btn-init')!.addEventListener('click', init);

// Auto-run init
setTimeout(init, 500);

document.getElementById('btn-refresh')!.addEventListener('click', () => {
    if (!manager) return log('Manager not initialized', 'error');

    log('Requesting Refresh (all pools)...', 'info');
    statusEl.textContent = 'Status: Refreshing...';
    manager.refresh();
    runUntilReady(manager);
});

document.getElementById('btn-pick')!.addEventListener('click', () => {
    if (!manager) return log('Manager not initialized', 'error');
    if (!manager.isReady()) return log('Manager not ready (refresh pending)', 'error');

    const picked = manager.pickPlayableStorylet();
    if (picked) {
        log(`Picked storylet: ${picked}`, 'success');
        playStorylet(picked);
    } else {
        log('No playable storylets found.', 'info');
    }
});

function playStorylet(knotID: string) {
    statusEl.textContent = `Playing: ${knotID}`;
    storyTextEl.textContent = '';
    storyChoicesEl.innerHTML = '';

    // Jump to the storylet
    story.ChoosePathString(knotID);

    continueStory();
}

function continueStory() {
    while (story.canContinue) {
        const text = story.Continue();
        const p = document.createElement('div');
        p.textContent = text;
        storyTextEl.appendChild(p);
    }

    if (story.currentChoices.length > 0) {
        story.currentChoices.forEach((choice: any) => {
            const btn = document.createElement('button');
            btn.textContent = choice.text;
            btn.onclick = () => {
                story.ChooseChoiceIndex(choice.index);
                storyChoicesEl.innerHTML = ''; // clear choices
                continueStory();
            };
            storyChoicesEl.appendChild(btn);
        });
    } else {
        log("Storylet finished. Refreshing...", 'info');
        statusEl.textContent = 'Status: Refreshing...';
        if (manager) {
            manager.refresh();
            runUntilReady(manager);
        }
    }
}

document.getElementById('btn-reset')!.addEventListener('click', () => {
    if (!manager) return log('Manager not initialized', 'error');
    manager.reset();
    log('Reset complete.', 'info');
    statusEl.textContent = 'Status: Reset';
});

function updatePlayableList() {
    if (!manager || !manager.isReady()) return;
    const list = manager.getPlayableStorylets();
    log(`Playable Storylets: [${list?.join(', ')}]`, 'info');
}

log('Test Harness Loaded. Click Initialize to start.', 'info');
