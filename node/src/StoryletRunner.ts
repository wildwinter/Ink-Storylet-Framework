import { StoryletManager } from './StoryletManager';

/**
 * Drives manager.tick() via setImmediate until areAllReady().
 * Call this after manager.refresh() if you don't have your own event loop integration.
 * Returns a cancel function that stops the ticking.
 *
 * Example:
 *   manager.refresh();
 *   const cancel = runUntilReady(manager);
 *   // onRefreshComplete fires once all pools are done
 *   // call cancel() early if needed
 */
export function runUntilReady(manager: StoryletManager): () => void {
    let handle: NodeJS.Immediate | null = null;

    function loop() {
        manager.tick();
        handle = manager.areAllReady() ? null : setImmediate(loop);
    }

    handle = setImmediate(loop);
    return () => { if (handle !== null) clearImmediate(handle); };
}
