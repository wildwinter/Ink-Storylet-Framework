const ink = require('inkjs');
const storyContent = require('./test-harness/test.ink.json');

const story = new ink.Story(storyContent);

console.log("Story created.");

function getAllKnotIDs_Debug() {
    const knotList = [];
    // @ts-ignore
    const mainContentContainer = story.mainContentContainer || story._mainContentContainer;

    if (!mainContentContainer) {
        console.warn("[Debug] Could not find mainContentContainer");
        return knotList;
    } else {
        console.log("[Debug] Found mainContentContainer");
    }

    // @ts-ignore
    const namedContent = mainContentContainer.namedOnlyContent || mainContentContainer.namedContent;

    if (namedContent) {
        console.log("[Debug] Found namedContent. Type:", typeof namedContent);
        console.log("[Debug] Is Map?", namedContent instanceof Map);
        console.log("[Debug] Has keys()?", typeof namedContent.keys === 'function');

        let keys = [];
        if (namedContent instanceof Map || typeof namedContent.keys === 'function') {
            keys = Array.from(namedContent.keys());
        } else {
            keys = Object.keys(namedContent);
        }

        console.log("[Debug] Keys found:", keys);

        for (const name of keys) {
            if (name === "global decl") continue;
            knotList.push(name);
        }
    } else {
        console.warn("[Debug] Could not find namedContent");
    }

    return knotList;
}

const prefix = "story_";
const discovered = [];
const knotIDs = getAllKnotIDs_Debug();

console.log("Knot IDs for scanning:", knotIDs);

for (const knotID of knotIDs) {
    if (knotID.startsWith(prefix)) {
        // Using a _ as a prefix for the function
        const functionName = "_" + knotID;
        if (!knotIDs.includes(functionName)) {
            console.error(`Can't find test function ${functionName} for storylet ${knotID}.`);
            continue;
        }

        // Check tags
        let once = false;
        // TagsForContentAtPath in inkjs is usually camelCase 'tagsForContentAtPath' in modern versions, 
        // but might be PascalCase in older ones.
        const tags = (story.TagsForContentAtPath) ? story.TagsForContentAtPath(knotID) : story.tagsForContentAtPath(knotID);

        console.log(`Tags for ${knotID}:`, tags);

        if (tags) {
            // Check for case-insensitive 'once'
            if (tags.some((t) => t.toLowerCase() === "once")) {
                once = true;
            }
        }

        discovered.push({ knotID, once });
    }
}

console.log("Final discovered:", discovered);
