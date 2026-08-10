/**
 * Debounced autosave.
 *
 * Saving on every document change is fine for a few kilobytes of JSON, but a
 * library holding a few image labels is megabytes, and the write path is
 * synchronous: `JSON.parse` + `JSON.stringify` + `localStorage.setItem`.
 * Measured at ~11ms per change against a 2.3MB library, most of it the
 * blocking setItem -- enough to drop frames while typing.
 *
 * Debouncing alone would risk losing the last edits if the tab closes mid-wait,
 * so a pending save is flushed when the page is hidden. `visibilitychange` to
 * hidden is the reliable signal on mobile, where `beforeunload` often never
 * fires.
 */

import { useEffect, useRef } from "react";

import type { LabelDocument } from "../core/document.ts";

const DEBOUNCE_MS = 400;

export interface AutosaveResult {
  /** Set when the last attempted save failed, e.g. the quota is exhausted. */
  error: string | null;
}

export function useAutosave(
  doc: LabelDocument,
  save: (doc: LabelDocument) => void,
  onResult: (result: AutosaveResult) => void,
): void {
  // Refs so the flush handler always sees the newest values without needing to
  // be torn down and rebuilt on every keystroke.
  const pending = useRef<LabelDocument | null>(null);
  const saveRef = useRef(save);
  const resultRef = useRef(onResult);
  saveRef.current = save;
  resultRef.current = onResult;

  const flush = useRef(() => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    try {
      saveRef.current(next);
      resultRef.current({ error: null });
    } catch (err) {
      resultRef.current({ error: err instanceof Error ? err.message : "Could not save." });
    }
  });

  useEffect(() => {
    pending.current = doc;
    const timer = setTimeout(() => flush.current(), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [doc]);

  // Flush on hide, and on unmount, so a debounced edit is never the one lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flush.current();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush.current);

    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush.current);
      flush.current();
    };
  }, []);
}
