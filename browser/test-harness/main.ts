import { Story } from 'inkjs';
import { StoryletManager } from '../src/StoryletManager';
import storyContent from '../../ink/test.ink.json';

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

        const workerUrl = new URL('../src/StoryletWorker.ts', import.meta.url).href;

        manager = new StoryletManager(story, storyContent, workerUrl);

        // Test addStorylets
        log('Scanning and adding storylets with prefix "story_"...', 'info');
        manager.addStorylets("story_");

        manager.onRefreshComplete = () => {
            log('Refresh Complete! Playable storylets available.', 'success');
            statusEl.textContent = 'Status: Ready';
            updatePlayableList();
        };

        log('Manager initialized. Auto-refreshing...', 'success');
        statusEl.textContent = 'Status: Initialized';
        manager.refresh();

    } catch (e: any) {
        log(`Error: ${e.message}`, 'error');
    }
}

document.getElementById('btn-init')!.addEventListener('click', init);

// Auto-run init
setTimeout(init, 500);

document.getElementById('btn-refresh')!.addEventListener('click', () => {
    if (!manager) return log('Manager not initialized', 'error');

    log('Requesting Refresh...', 'info');
    statusEl.textContent = 'Status: Refreshing...';
    manager.refresh();
});

document.getElementById('btn-pick')!.addEventListener('click', () => {
    if (!manager) return log('Manager not initialized', 'error');
    if (!manager.isReady) return log('Manager not ready (refresh pending)', 'error');

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
        if (manager) manager.refresh();
    }
}

document.getElementById('btn-reset')!.addEventListener('click', () => {
    if (!manager) return log('Manager not initialized', 'error');
    manager.reset();
    log('Reset complete.', 'info');
    statusEl.textContent = 'Status: Reset';
});

function updatePlayableList() {
    if (!manager || !manager.isReady) return;
    const list = manager.getPlayableStorylets();
    log(`Playable Storylets: [${list?.join(', ')}]`, 'info');
}

log('Test Harness Loaded. Click Initialize to start.', 'info');
