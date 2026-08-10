/**
 * Editor state: the document, its history, and the current selection.
 *
 * Deliberately a small useReducer rather than a state library -- the whole
 * surface is one document plus a selected id.
 */

import { useCallback, useEffect, useMemo, useReducer } from "react";

import type { Element, LabelDocument } from "../core/document.ts";
import type { LabelSizeId, Orientation } from "../core/label.ts";
import {
  amend,
  canRedo,
  canUndo,
  createHistory,
  push,
  redo,
  undo,
  type History,
} from "./history.ts";
import {
  addElement,
  createDocument,
  createTextElement,
  removeElement,
  reorderElement,
  renameDocument,
  setLabelSize,
  setOrientation,
  updateElement,
} from "./operations.ts";

export interface EditorState {
  history: History<LabelDocument>;
  selectedId: string | null;
}

export type EditorAction =
  | { type: "load"; doc: LabelDocument }
  | { type: "addText" }
  | { type: "update"; id: string; patch: Partial<Element>; transient?: boolean }
  | { type: "remove"; id: string }
  | { type: "reorder"; id: string; direction: "forward" | "backward" }
  | { type: "setSize"; sizeId: LabelSizeId }
  | { type: "setOrientation"; orientation: Orientation }
  | { type: "rename"; name: string }
  | { type: "select"; id: string | null }
  | { type: "beginGesture" }
  | { type: "undo" }
  | { type: "redo" };

function reducer(state: EditorState, action: EditorAction): EditorState {
  const doc = state.history.present;

  switch (action.type) {
    case "load":
      return { history: createHistory(action.doc), selectedId: null };

    case "addText": {
      const element = createTextElement(doc);
      return {
        history: push(state.history, addElement(doc, element)),
        selectedId: element.id,
      };
    }

    case "update": {
      const next = updateElement(doc, action.id, action.patch);
      // Transient updates amend the present instead of adding an undo step, so
      // a drag collapses into a single entry (see beginGesture).
      return {
        ...state,
        history: action.transient ? amend(state.history, next) : push(state.history, next),
      };
    }

    case "remove":
      return {
        history: push(state.history, removeElement(doc, action.id)),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      };

    case "reorder":
      return {
        ...state,
        history: push(state.history, reorderElement(doc, action.id, action.direction)),
      };

    case "setSize":
      return { ...state, history: push(state.history, setLabelSize(doc, action.sizeId)) };

    case "setOrientation":
      return { ...state, history: push(state.history, setOrientation(doc, action.orientation)) };

    case "rename":
      return { ...state, history: push(state.history, renameDocument(doc, action.name)) };

    case "select":
      return { ...state, selectedId: action.id };

    // Snapshots the current document so the gesture that follows is one undo
    // step. Subsequent updates during the gesture pass transient: true.
    case "beginGesture":
      return { ...state, history: push(state.history, doc) };

    case "undo": {
      const history = undo(state.history);
      return { history, selectedId: stillPresent(history.present, state.selectedId) };
    }

    case "redo": {
      const history = redo(state.history);
      return { history, selectedId: stillPresent(history.present, state.selectedId) };
    }
  }
}

/** Drop a selection that no longer exists after a history jump. */
function stillPresent(doc: LabelDocument, id: string | null): string | null {
  if (id === null) return null;
  return doc.elements.some((el) => el.id === id) ? id : null;
}

export function useEditor(initial?: LabelDocument) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    history: createHistory(initial ?? createDocument()),
    selectedId: null,
  }));

  const doc = state.history.present;

  const selected = useMemo(
    () => doc.elements.find((el) => el.id === state.selectedId) ?? null,
    [doc, state.selectedId],
  );

  const handleUndo = useCallback(() => dispatch({ type: "undo" }), []);
  const handleRedo = useCallback(() => dispatch({ type: "redo" }), []);

  // Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y). Ignored while typing in a
  // field, where the browser's own undo should win.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!(event.metaKey || event.ctrlKey)) return;

      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
      } else if (key === "y") {
        event.preventDefault();
        handleRedo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo]);

  return {
    doc,
    selected,
    selectedId: state.selectedId,
    dispatch,
    canUndo: canUndo(state.history),
    canRedo: canRedo(state.history),
  };
}
