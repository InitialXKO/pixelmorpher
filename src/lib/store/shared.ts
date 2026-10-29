// ============================================================
// PixelMorpher - Store shared module-level variables
// ============================================================
// Module-level drag transaction tracking.
// Using module-level variables (instead of store state) for drag tracking avoids
// any potential timing issues with Zustand's get()/set() cycle and ensures
// pushUndo suppression is 100% reliable.

export let _isDragActive = false;
export let _dragPostStackLen = 0; // undoStack.length right after beginDrag pushed its entry

export function setDragActive(v: boolean) { _isDragActive = v; }
export function setDragPostStackLen(n: number) { _dragPostStackLen = n; }

export function resetDragState() {
  _isDragActive = false;
  _dragPostStackLen = 0;
}
