/**
 * Undo/redo history.
 *
 * A plain snapshot stack. This is only correct because documents are immutable
 * (see src/core/document.ts) -- if anything mutated a document in place, every
 * snapshot in the stack would change with it and history would silently break.
 */

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

/** Cap on retained snapshots. Labels are small; this is generous. */
export const HISTORY_LIMIT = 100;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] };
}

/** Record a new state, clearing the redo stack. */
export function push<T>(history: History<T>, next: T): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [] };
}

/**
 * Replace the present without creating an undo step.
 *
 * For continuous gestures: a drag should produce one undo entry, not one per
 * mousemove. Call push() once when the gesture starts, then amend() as it runs.
 */
export function amend<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  if (!canUndo(history)) return history;
  const previous = history.past[history.past.length - 1]!;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (!canRedo(history)) return history;
  const next = history.future[0]!;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  };
}
