# Ink Storylet Framework

A simple **storylet** framework for Ink.

See my medium post - [over here](https://wildwinter.medium.com/an-ink-unity-storylet-framework-3b2cc0910b3) - for the general principles of the framework.

There are now three versions of the framework:

1. The original Unity version, which can be found in the `unity` directory.
2. The TypeScript (Browser) version, which can be found in the `browser` directory.
3. The TypeScript (Node.js) version, which can be found in the `node` directory.

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

* `true` / `false`: Is it available? (Means weight 1 or 0)
* `int`: A weighted value. Higher numbers mean the storylet is more likely to be picked if you are selecting randomly.

```ink
=== function _story_meet_the_king ===
// Only available if we have met the guard AND not yet met the king
~ return met_guard and not met_king
```

### 3. Tags

* `#once`: applied to a knot. If this tag is present, the storylet will be discarded from the deck after it is played successfully. Otherwise, it remains in the deck and can be selected again.

## Pools

All three implementations support **named pools** — independent groups of storylets that can be registered, queried, and refreshed separately while sharing the same underlying Ink story. This is useful when you have different categories of content that need to be managed independently, e.g. `"encounters"` and `"dialogues"`.

All pool parameters default to `"default"`, so existing single-pool usage requires no changes.

```typescript
// TypeScript / Node example
manager.addStorylets("encounter_", "encounters");
manager.addStorylets("dialogue_", "dialogues");

// Refresh all pools at once, or a specific one
manager.refresh();           // all pools
manager.refresh("encounters"); // one pool

// Query a specific pool
const available = manager.getPlayableStorylets(false, "encounters");
const picked    = manager.pickPlayableStorylet("encounters");
```

```csharp
// Unity / C# example
storyletManager.AddStorylets("encounter_", "encounters");
storyletManager.AddStorylets("dialogue_", "dialogues");

storyletManager.Refresh();             // all pools
storyletManager.Refresh("encounters"); // one pool

var available = storyletManager.GetPlayableStorylets(false, "encounters");
var picked    = storyletManager.PickPlayableStorylet("encounters");
```

The `onRefreshComplete` callback (or `OnRefreshComplete` in C#) now receives the name of the pool that just finished refreshing, and is called once per pool. Use `areAllReady()` / `AreAllReady()` to check whether every registered pool has completed its refresh.

---

## Usage: TypeScript (Web)

The TypeScript implementation found in the `./browser` directory is designed for the web. It runs the storylet selection logic in a **Web Worker** to prevent blocking the main thread (UI) during complex storylet evaluations.

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

// Register storylets — optionally pass a pool name (defaults to "default")
manager.addStorylets("story_");
manager.addStorylets("encounter_", "encounters");

// Called once per pool each time that pool's refresh completes
manager.onRefreshComplete = (pool: string) => {
    const playable = manager.getPlayableStorylets(false, pool);
    console.log(`Available storylets [${pool}]:`, playable);
};

// Refresh all pools
manager.refresh();
```

### State checks

```typescript
manager.isReady()             // default pool
manager.isReady("encounters") // specific pool
manager.areAllReady()         // true when every registered pool is ready
```

### Playing a Storylet

```typescript
// Pick one from the default pool (randomly weighted)
const knotName = manager.pickPlayableStorylet();

// Or from a named pool
const knotName = manager.pickPlayableStorylet("encounters");

if (knotName) {
    story.ChoosePathString(knotName);
    while (story.canContinue) {
        console.log(story.Continue());
    }
}
```

---

## Usage: Node.js

The `node` directory contains a specialized implementation for Node.js using `worker_threads`.

```typescript
import { Story } from 'inkjs';
import { StoryletManager } from './StoryletManager'; // path to compiled JS

const story = new Story(storyContent);
const manager = new StoryletManager(story, storyContent, './StoryletWorker.js');

// Register storylets — optionally pass a pool name (defaults to "default")
manager.addStorylets("story_");
manager.addStorylets("encounter_", "encounters");

// Called once per pool each time that pool's refresh completes
manager.onRefreshComplete = (pool: string) => {
    console.log(`Available [${pool}]:`, manager.getPlayableStorylets(false, pool));
    if (manager.areAllReady()) {
        // All pools are ready — safe to proceed
    }
};

// Refresh all pools
manager.refresh();
```

---

## Usage: Unity (C#)

The Unity version runs the refresh spread across frames using a `Tick()` method.

### Unity Setup

```csharp
using InkStoryletFramework;

StoryletsManager storyletManager = new StoryletsManager(myInkStory);

// Register storylets — optionally pass a pool name (defaults to "default")
storyletManager.AddStorylets("story_");
storyletManager.AddStorylets("encounter_", "encounters");

// Called once per pool each time that pool's refresh completes
storyletManager.OnRefreshComplete = (pool) => {
    Debug.Log($"Pool '{pool}' is ready.");
    if (storyletManager.AreAllReady()) {
        // All pools are ready — safe to proceed
    }
};

// Refresh all pools (or pass a pool name to refresh just one)
storyletManager.Refresh();
```

### Game Loop

`Tick()` must be called every frame. It processes up to `StoryletsToProcessPerFrame` storylets per refreshing pool per frame.

```csharp
void Update()
{
    storyletManager.Tick();

    if (storyletManager.IsReady())                  // default pool
    if (storyletManager.IsReady("encounters"))       // specific pool
    if (storyletManager.AreAllReady())              // all pools

    var playable = storyletManager.GetPlayableStorylets();                    // default pool
    var playable = storyletManager.GetPlayableStorylets(false, "encounters"); // named pool

    var picked = storyletManager.PickPlayableStorylet();             // default pool
    var picked = storyletManager.PickPlayableStorylet("encounters"); // named pool
}
```
