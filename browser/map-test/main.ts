import { Story } from 'inkjs';
import { StoryletManager } from '../src/StoryletManager';
import { MapManager, MapDef } from './map';
import storyContent from '../../tests/map/map-test.ink.json';

// ---------------------------------------------------------------------------
// Map setup
// ---------------------------------------------------------------------------

const mainMap: MapDef = {
    id: 'main',
    imgSrc: './images/town-map.png',
    locations: {
        town_hall: { left: '40%',   top: '25%', title: 'Town Hall 🏛️' },
        library:   { left: '77%',   top: '37%', title: 'The Library 📚' },
        east:      { left: '71.5%', top: '85%', title: 'East House 🏠' },
        bar:       { left: '22%',   top: '62%', title: 'Frog & Horses 🍺' },
        cave:      { left: '56%',   top: '35%', title: 'A Cave 🌊' },
    }
};

const caveMap: MapDef = {
    id: 'cave',
    imgSrc: './images/cave-map.png',
    locations: {
        exit: { left: '40%', top: '95%', title: 'Exit 🚪' },
        well: { left: '68%', top: '59%', title: 'The Well 💧' },
    }
};

const mapManager = new MapManager('#map-container', (id, _title) => {
    // When a map location is clicked, find the first available storylet for that loc
    const storylet = manager.getFirstPlayableStoryletWithTag('loc', id);
    if (storylet) chooseStorylet(storylet);
});

mapManager.addMap(mainMap);
mapManager.addMap(caveMap);
mapManager.setMap('main');

// ---------------------------------------------------------------------------
// Ink story setup
// ---------------------------------------------------------------------------

// @ts-ignore
const story = new Story(storyContent);

// Bind external functions so Ink can read/change the current map
story.BindExternalFunction('set_map', (mapName: string) => {
    mapManager.setMap(mapName);
});

story.BindExternalFunction('get_map', () => {
    return mapManager.getCurrentMapName();
});

// ---------------------------------------------------------------------------
// StoryletManager setup
// The Ink file has #storylets:main,main / #storylets:cave,cave / #storylets:wizard,wizard
// so pools are registered automatically from those global tags.
// ---------------------------------------------------------------------------

const workerUrl = new URL('../src/StoryletWorker.ts', import.meta.url).href;
const manager = new StoryletManager(story, workerUrl);

// onRefreshComplete fires once per pool. Once all pools are ready, update the map.
manager.onRefreshComplete = (_pool: string) => {
    if (manager.areAllReady()) onAllPoolsReady();
};

// ---------------------------------------------------------------------------
// Story display
// ---------------------------------------------------------------------------

const storyRoot = document.querySelector('#story')!;

// Reset button
const resetButton = document.createElement('button');
resetButton.textContent = 'Reset Story';
resetButton.addEventListener('click', reset);
document.getElementById('reset-container')!.appendChild(resetButton);

// Kick off the first refresh
manager.refresh();

// ---------------------------------------------------------------------------
// Map / storylet logic
// ---------------------------------------------------------------------------

function onAllPoolsReady() {
    let anyAvailable = false;

    // For each location marker on the current map, show it if a storylet is
    // available there, or hide it if not.
    mapManager.iterateSymbols((_element, locationId) => {
        const storylet = manager.getFirstPlayableStoryletWithTag('loc', locationId);
        if (storylet) {
            const desc = String(manager.getStoryletTag(storylet, 'desc', ''));
            mapManager.setSymbolDesc(locationId, desc);
            mapManager.showSymbol(locationId);
            anyAvailable = true;
        } else {
            mapManager.hideSymbol(locationId);
        }
    });

    if (!anyAvailable) {
        alert('Story complete! Close this to reset.');
        reset();
    }
}

function chooseStorylet(knotID: string) {
    mapManager.lockMap();

    // Mark as played (no pool specified → sent to all pools; worker ignores unknown IDs)
    manager.markPlayed(knotID);

    // Show the storylet title as a heading
    const heading = document.createElement('h3');
    heading.textContent = String(manager.getStoryletTag(knotID, 'desc', knotID));
    storyRoot.appendChild(heading);

    // Jump to the storylet knot in the Ink story and run it
    story.ChoosePathString(knotID);
    runInk();
}

function runInk() {
    while (story.canContinue) {
        const text = story.Continue();
        const para = document.createElement('p');
        para.innerHTML = text ?? '';
        storyRoot.appendChild(para);
    }

    if (story.currentChoices.length === 0) {
        // Storylet finished — add divider, unlock map, refresh availability
        storyRoot.appendChild(document.createElement('hr'));
        scrollToBottom();
        mapManager.unlockMap();
        manager.refresh();
        return;
    }

    // Render Ink choices as clickable list items
    const ul = document.createElement('ul');
    ul.classList.add('choices');
    story.currentChoices.forEach((choice: any) => {
        const li = document.createElement('li');
        li.classList.add('choice');
        li.innerHTML = `<a href="#">${choice.text}</a>`;
        li.querySelector('a')!.addEventListener('click', (e) => {
            e.preventDefault();
            story.ChooseChoiceIndex(choice.index);
            ul.remove();
            runInk();
        });
        ul.appendChild(li);
    });
    storyRoot.appendChild(ul);
    scrollToBottom();
}

function reset() {
    story.ResetState();
    manager.reset();
    mapManager.setMap('main');
    mapManager.unlockMap();
    storyRoot.innerHTML = '';
    manager.refresh();
}

function scrollToBottom() {
    storyRoot.scrollTop = storyRoot.scrollHeight;
}
