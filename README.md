# Ink Storylet Framework

A simple **storylet** framework for Ink.

See my medium post - [over here](https://wildwinter.medium.com/an-ink-unity-storylet-framework-3b2cc0910b3) - for the general principles of the framework.

There are two versions of the framework:

1. The original Unity version, which can be found in the `unity` directory.
2. The TypeScript (Browser) version, which can be found in the `typescript-browser` directory.
3. The TypeScript (Node.js) version, which can be found in the `typescript-node` directory.

## What is a Storylet System?

Traditional interactive fiction often looks like a tree: you start at the root, make choices, and branch out. This can become complex to manage as the game grows.

A **Storylet** system turns this around. Instead of the story logic deciding what happens next based on where you are in the tree, the **Storylets** themselves decide if they are relevant right now.

Think of it like a deck of cards. The "Storylet Manager" looks at all the cards (storylets) in the deck and asks each one: "Can you be played right now?" based on the current world state (variables).

## Ink Syntax & Conventions

This framework uses standard Ink syntax but relies on a specific **naming convention** to link story content with selection logic.

### 1. The Storylet Knot

Each storylet is a regular knot, but its name must start with a specific prefix (e.g. `story_`).

```ink
=== story_meet_the_king ===
You approach the King's throne.
// ... story content ...
-> DONE
```

### 2. The Predicate Function

For every storylet knot, there may be a corresponding Ink function. This function shares the name of the knot but is prefixed with an underscore (`_`).

This function determines if the storylet is available. It can return:

* `true` / `false`: Is it available? (Means weight1 or 0)
* `int`: A weighted value. Higher numbers mean the storylet is more likely to be picked if you are selecting randomly.

```ink
=== function _story_meet_the_king ===
// Only available if we have met the guard AND not yet met the king
~ return met_guard and not met_king
```

### 3. Tags

* `#once`: detailed on a knot. If this tag is present, the storylet will be discarded from the deck after it is played successfully. Otherwise, it remains in the deck and can be selected again.

## Usage: TypeScript (Web)

The TypeScript implementation is designed for the web. It runs the storylet selection logic in a **Web Worker** to prevent blocking the main thread (UI) during complex storylet evaluations.

### Installation

Ensure you have `inkjs` installed.

```bash
npm install inkjs
```

### Setup

```typescript
import { Story } from 'inkjs';
import { StoryletManager } from './path/to/StoryletManager';
import storyContent from './your-story.json';

// Initialize Ink Story
const story = new Story(storyContent);

// Initialize Manager (requires path to the worker script)
const manager = new StoryletManager(story, storyContent, './StoryletWorker.js');

// Register Storylets
// Scans the story for all knots starting with "story_"
manager.addStorylets("story_");

// Start the Refresh Loop (Async)
manager.onRefreshComplete = () => {
    // This is called when the worker finishes calculating playable storylets
    const playable = manager.getPlayableStorylets();
    console.log("Available storylets:", playable);
};

// Trigger the first refresh
manager.refresh();
```

### Playing a Storylet

When you are ready to play a storylet (e.g., user clicked a card):

```typescript
// Pick one (randomly weighted)
// This is just an example.
const knotName = manager.pickPlayableStorylet();

if (knotName) {
    // Jump to it in the main Ink story
    story.ChoosePathString(knotName);
    
    // Play as normal
    while (story.canContinue) {
        console.log(story.Continue());
    }
}
```

## Usage: Node.js

The `typescript-node` directory contains a specialized implementation for Node.js using `worker_threads`.

```javascript
const { Story } = require('inkjs');
const { StoryletManager } = require('./StoryletManager'); // Path to compiled JS
const storyContent = require('./your-story.json');

// Initialize
const story = new Story(storyContent);

// Initialize Manager
// Ensure the worker script is also compiled and accessible
// The Node version handles worker_threads internally
const manager = new StoryletManager(story, storyContent, './StoryletWorker.js');

// Use as normal
manager.addStorylets("story_");
manager.onRefreshComplete = () => {
    console.log("Available:", manager.getPlayableStorylets());
};
manager.refresh();
```

## Usage: Unity (C#)

The Unity version runs synchronously on the main thread.

### Setup

```csharp
using InkStoryletFramework;

// Initialize
StoryletsManager storyletManager = new StoryletsManager(myInkStory);

// Add Storylets
storyletManager.AddStorylets("story_");

// Refresh (Must be called to populate the list)
storyletManager.Refresh();
```

### Game Loop

You generally want to tick the manager to process updates.

```csharp
void Update() {
    storyletManager.Tick();
    
    if (storyletManager.IsReady) {
        var playable = storyletManager.GetPlayableStorylets();
        // Update UI...
    }
}
```
