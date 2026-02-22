import { StoryletManager } from './StoryletManager';

/**
 * Drives manager.tick() via requestAnimationFrame until areAllReady().
 * Call this after manager.refresh() if you don't have your own game loop.
 * Returns a cancel function that stops the ticking.
 *
 * Example:
 *   manager.refresh();
 *   const cancel = runUntilReady(manager);
 *   // onRefreshComplete fires once all pools are done
 *   // call cancel() early if needed
 */
export function runUntilReady(manager: StoryletManager): () => void {
    let rafId: number | null = null;

    function loop() {
        manager.tick();
        rafId = manager.areAllReady() ? null : requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);
    return () => { if (rafId !== null) cancelAnimationFrame(rafId); };
}
