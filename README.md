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

Each storylet is a regular knot. Its name must start with the pool name followed by an underscore (e.g. `story_`).

```ink
=== story_meet_the_king ===
You approach the King's throne.
// ... story content ...
-> DONE
```

### 2. The Predicate Function

For every storylet knot there must be a corresponding Ink function. It shares the knot's name but is prefixed with an underscore (`_`).

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

* `#storylets:name` / `#storylets:name,pool`: applied as a **global tag** (at the very top of an Ink file). Registers a pool of storylets automatically when the `StoryletManager` is created, without any extra code. Multiple tags can be used to register multiple pools.

```ink
#storylets:story
#storylets:encounter,encounters
```

This is equivalent to calling `addStorylets("story")` and `addStorylets("encounter", "encounters")` in code. Note that the name is given **without** a trailing underscore — the underscore is inferred automatically. You can use whichever approach suits your project, or mix both.

* **Custom tags**: any `#key: value` tags on a knot are automatically read and cached at registration time. Use `getStoryletTag()` to retrieve them (see Tag Queries below).

```ink
=== story_meet_the_merchant ===
#desc: Visit the travelling merchant
#loc: market
The merchant has many fine wares.
-> DONE
```

### 4. Group Predicates

If you define an Ink function whose name is `_<name>()` — where `name` is the same name passed to `addStorylets()` — it acts as a **group predicate**. It is evaluated once per refresh, before any individual storylet predicates in that group. If it returns false, the entire group is skipped.

This is particularly useful for location- or state-based pools:

```ink
VAR current_map = "town"

=== function _encounter() ===
// Only check encounter storylets when on the world map
~ return current_map == "world"
```

Group predicates that call Ink **external functions** (like `get_map()`) work correctly because they are always evaluated on the main thread, where those functions are bound.

---

## Pools

All three implementations support **named pools** — independent groups of storylets that can be registered, queried, and refreshed separately while sharing the same underlying Ink story. This is useful when you have different categories of content that need to be managed independently.

All pool parameters default to `"default"`, so existing single-pool usage requires no changes.

```typescript
// TypeScript / Node example
manager.addStorylets("encounter", "encounters");
manager.addStorylets("dialogue", "dialogues");

// Refresh all pools at once, or a specific one
manager.refresh();             // all pools
manager.refresh("encounters"); // one pool

// Query a specific pool
const available = manager.getPlayableStorylets(false, "encounters");
const picked    = manager.pickPlayableStorylet("encounters");
```

```csharp
// Unity / C# example
storyletManager.AddStorylets("encounter", "encounters");
storyletManager.AddStorylets("dialogue", "dialogues");

storyletManager.Refresh();             // all pools
storyletManager.Refresh("encounters"); // one pool

var available = storyletManager.GetPlayableStorylets(false, "encounters");
var picked    = storyletManager.PickPlayableStorylet("encounters");
```

The `onRefreshComplete` callback (or `OnRefreshComplete` in C#) fires once per pool as each finishes. Use `areAllReady()` / `AreAllReady()` to check whether every registered pool has completed its refresh.

---

## Tag Queries

Once storylets are registered their tags are cached and can be queried at any time.

```typescript
// TypeScript / Node
const desc = manager.getStoryletTag("story_meet_king", "desc", "");

// Filter the current hand by tag — searches all pools if pool is omitted
const atMarket = manager.getPlayableStoryletsWithTag("loc", "market");
const atMarket = manager.getPlayableStoryletsWithTag("loc", "market", "encounters"); // one pool

// Get the first match
const first = manager.getFirstPlayableStoryletWithTag("loc", "market");
```

```csharp
// Unity / C#
object desc = storyletManager.GetStoryletTag("story_meet_king", "desc", "");

// Searches all pools if pool is omitted (pass a pool name to restrict)
List<string> atMarket = storyletManager.GetPlayableStoryletsWithTag("loc", "market");
string first = storyletManager.GetFirstPlayableStoryletWithTag("loc", "market");
```

Tag parsing rules:

* `#once` → `{ "once": true }`
* `#desc: Some text` → `{ "desc": "Some text" }`
* `#loc: market` → `{ "loc": "market" }`
* `"true"` / `"false"` string values are converted to booleans
* Everything else is returned as a trimmed string

---

## Usage: TypeScript (Web)

The TypeScript implementation found in the `./browser` directory is designed for the web. It runs the storylet selection logic in a **Web Worker** to prevent blocking the main thread during complex storylet evaluations.

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

// Initialize Manager (requires path to the worker script).
// Any #storylets: global tags in the Ink file are registered automatically.
const manager = new StoryletManager(story, './StoryletWorker.js');

// Optionally register additional storylets in code
// (not needed if pools are declared via #storylets: global tags)
manager.addStorylets("story");
manager.addStorylets("encounter", "encounters");

// Called once per pool each time that pool's refresh completes
manager.onRefreshComplete = (pool: string) => {
    if (manager.areAllReady()) {
        const playable = manager.getPlayableStorylets(false, pool);
        console.log(`Available storylets [${pool}]:`, playable);
    }
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

### Running the test harnesses

```bash
cd browser
npm run test      # basic test harness (tests/test1/test.ink)
npm run map-test  # map-based demo   (tests/map/map-test.ink)
```

---

## Usage: Node.js

The `node` directory contains a specialized implementation for Node.js using `worker_threads`.

```typescript
import { Story } from 'inkjs';
import { StoryletManager } from './StoryletManager'; // path to compiled JS

const story = new Story(storyContent);

// Any #storylets: global tags in the Ink file are registered automatically.
const manager = new StoryletManager(story, './StoryletWorker.js');

// Optionally register additional storylets in code
manager.addStorylets("story");
manager.addStorylets("encounter", "encounters");

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

The Unity version runs the refresh spread across frames using a `Tick()` method. Any `#storylets:` global tags in the Ink file are parsed and registered automatically in the constructor.

### Unity Setup

```csharp
using InkStoryletFramework;

StoryletsManager storyletManager = new StoryletsManager(myInkStory);

// Optionally register additional storylets in code
// (not needed if pools are declared via #storylets: global tags)
storyletManager.AddStorylets("story");
storyletManager.AddStorylets("encounter", "encounters");

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

    if (storyletManager.IsReady())                   // default pool
    if (storyletManager.IsReady("encounters"))        // specific pool
    if (storyletManager.AreAllReady())               // all pools

    // Get playable storylets (pool omitted = default pool)
    var playable = storyletManager.GetPlayableStorylets();
    var playable = storyletManager.GetPlayableStorylets(false, "encounters");

    // Pick randomly (weighted)
    var picked = storyletManager.PickPlayableStorylet();
    var picked = storyletManager.PickPlayableStorylet("encounters");

    // Tag queries (pool omitted = all pools)
    string desc  = storyletManager.GetStoryletTag("story_foo", "desc", "") as string;
    var atMarket = storyletManager.GetPlayableStoryletsWithTag("loc", "market");
    string first = storyletManager.GetFirstPlayableStoryletWithTag("loc", "market");
}
```

### Mark Played

After playing a storylet, always mark it as played so the engine knows it has been used:

```csharp
// With explicit pool
storyletManager.MarkPlayed(knotID, "encounters");

// Without pool — searches all pools (safe; unknown IDs are ignored)
storyletManager.MarkPlayed(knotID);
```

---

## Compiling Ink Files

Use the inkjs bundled compiler (do **not** use the separate `inklecate` npm package, which is outdated):

```bash
node browser/node_modules/inkjs/bin/inkjs-compiler.js your-story.ink -o your-story.ink.json
```

Or use the convenience script from the root to recompile all included Ink files:

```bash
npm run compile-ink
```

---

## Map-Test Demo

`browser/map-test/` is a full interactive demo showing location-based storylets using the tag system and group predicates. It demonstrates:

* Three pools (`main`, `cave`, `wizard`) gated by group predicates (`_main()`, `_cave()`, `_wizard()`)
* `#loc: <id>` tags on storylets to associate them with map locations
* `#desc: <text>` tags shown in map tooltips
* `getPlayableStoryletsWithTag()` to find what's available at each location
* `getFirstPlayableStoryletWithTag()` to handle location clicks
* External Ink functions (`set_map`, `get_map`) integrated with the map UI

```bash
cd browser
npm run map-test
```

The Ink source is in [tests/map/map-test.ink](tests/map/map-test.ink).
