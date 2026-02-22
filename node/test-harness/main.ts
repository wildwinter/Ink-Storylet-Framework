import { Story } from 'inkjs';
import { StoryletManager } from '../src/StoryletManager';
import { runUntilReady } from '../src/StoryletRunner';
import storyContent from '../../tests/test1/test.ink.json';
import * as readline from 'readline';

// Create readline interface
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function log(msg: string, type: 'info' | 'error' | 'success' = 'info') {
    const time = new Date().toLocaleTimeString();
    const color = type === 'error' ? '\x1b[31m' : type === 'success' ? '\x1b[32m' : '\x1b[36m';
    const reset = '\x1b[0m';
    console.log(`${color}[${time}] ${msg}${reset}`);
}

async function main() {
    try {
        log('Initializing StoryletManager...', 'info');

        // @ts-ignore
        const story = new Story(storyContent);

        const manager = new StoryletManager(story);

        // onRefreshComplete now receives the pool name that just finished refreshing.
        manager.onRefreshComplete = (pool: string) => {
            log(`Refresh Complete for pool "${pool}"! Playable storylets available.`, 'success');
            const hand = manager.getPlayableStorylets(false, pool);
            if (hand) {
                console.log(`\nPlayable Storylets [${pool}]:`, hand);
            }
            // Only prompt the user once all registered pools are ready.
            if (manager.areAllReady()) {
                promptUser(manager, story);
            }
        };

        //log('Scanning and adding storylets with prefix "story_" into the default pool...', 'info');
        //manager.addStorylets("story_");
        // Example of adding a second pool — uncomment and add matching knots to your ink file:
        // manager.addStorylets("encounter_", "encounters");

        log('Manager initialized. Refreshing all pools...', 'success');
        manager.refresh();
        runUntilReady(manager);

    } catch (e: any) {
        log(`Error: ${e.message}`, 'error');
        rl.close();
    }
}

function promptUser(manager: StoryletManager, story: Story) {
    rl.question('\nOptions: (p)ick storylet, (r)efresh, (q)uit > ', (answer) => {
        const choice = answer.trim().toLowerCase();

        if (choice === 'q') {
            log('Exiting...', 'info');
            rl.close();
            process.exit(0);
        } else if (choice === 'r') {
            log('Requesting Refresh (all pools)...', 'info');
            manager.refresh();
            runUntilReady(manager);
        } else if (choice === 'p') {
            if (!manager.isReady()) {
                log('Manager not ready.', 'error');
                promptUser(manager, story);
                return;
            }

            const picked = manager.pickPlayableStorylet();
            if (picked) {
                log(`Picked storylet: ${picked}`, 'success');
                playStorylet(picked, story, manager);
            } else {
                log('No playable storylets found.', 'info');
                promptUser(manager, story);
            }
        } else {
            promptUser(manager, story);
        }
    });
}

function playStorylet(knotID: string, story: Story, manager: StoryletManager) {
    console.log(`\n--- Playing: ${knotID} ---`);
    story.ChoosePathString(knotID);
    continueStory(story, manager);
}

function continueStory(story: Story, manager: StoryletManager) {
    while (story.canContinue) {
        const text = story.Continue();
        console.log(text?.trim());
    }

    if (story.currentChoices.length > 0) {
        console.log('\nChoices:');
        story.currentChoices.forEach((choice, index) => {
            console.log(`${index + 1}. ${choice.text}`);
        });

        rl.question('> ', (answer) => {
            const idx = parseInt(answer) - 1;
            if (idx >= 0 && idx < story.currentChoices.length) {
                story.ChooseChoiceIndex(idx);
                continueStory(story, manager);
            } else {
                console.log('Invalid choice.');
                continueStory(story, manager); // ask again
            }
        });
    } else {
        log("Storylet finished.", 'info');
        // Auto-refresh all pools after play
        manager.refresh();
        runUntilReady(manager);
    }
}

main();
