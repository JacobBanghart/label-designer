/**
 * Editor state: the document, its history, and the current selection.
 *
 * Deliberately a small useReducer rather than a state library -- the whole
 * surface is one document plus a selected id.
 */

import { useEffect, useMemo, useReducer } from "react";

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
  createShapeElement,
  createTextElement,
  nextId,
  removeElement,
  reorderElement,
  renameDocument,
  setLabelSize,
  setOrientation,
  updateElement,
  type ShapeKind,
} from "./operations.ts";

export interface EditorState {
  history: History<LabelDocument>;
  selectedId: string | null;
}

export type EditorAction =
  | { type: "load"; doc: LabelDocument }
  | { type: "addText" }
  | { type: "addShape"; kind: ShapeKind }
  | { type: "addElement"; element: Element }
  | { type: "update"; id: string; patch: Partial<Element>; transient?: boolean }
  | { type: "remove"; id: string }
  | { type: "reorder"; id: string; direction: "forward" | "backward" }
  | { type: "setSize"; sizeId: LabelSizeId }
  | { type: "setOrientation"; orientation: Orientation }
  | { type: "rename"; name: string }
  | { type: "select"; id: string | null }
  | { type: "duplicate"; id: string }
  | { type: "nudge"; id: string; dx: number; dy: number }
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

    case "addShape": {
      const element = createShapeElement(doc, action.kind);
      return {
        history: push(state.history, addElement(doc, element)),
        selectedId: element.id,
      };
    }

    // Used by drag-to-draw, which builds its own geometry from the gesture.
    case "addElement":
      return {
        history: push(state.history, addElement(doc, action.element)),
        selectedId: action.element.id,
      };

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

    case "duplicate": {
      const source = doc.elements.find((el) => el.id === action.id);
      if (!source) return state;
      // Offset slightly so the copy is visibly distinct from its original.
      const copy = { ...source, id: nextId(source.kind), x: source.x + 16, y: source.y + 16 };
      return { history: push(state.history, addElement(doc, copy)), selectedId: copy.id };
    }

    case "nudge": {
      const element = doc.elements.find((el) => el.id === action.id);
      if (!element) return state;
      const next = updateElement(doc, action.id, {
        x: element.x + action.dx,
        y: element.y + action.dy,
      });
      return { ...state, history: push(state.history, next) };
    }

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

  const selectedId = state.selectedId;

  /**
   * Keyboard shortcuts.
   *
   * All of them defer to form fields: while the caret is in a text box the
   * browser's own editing behaviour must win, or typing "d" in a label would
   * duplicate an element and Backspace would delete one.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;

      const key = event.key.toLowerCase();
      const modified = event.metaKey || event.ctrlKey;

      if (modified) {
        if (key === "z") {
          event.preventDefault();
          dispatch({ type: event.shiftKey ? "redo" : "undo" });
        } else if (key === "y") {
          event.preventDefault();
          dispatch({ type: "redo" });
        } else if (key === "d" && selectedId) {
          event.preventDefault();
          dispatch({ type: "duplicate", id: selectedId });
        }
        return;
      }

      if (key === "escape") {
        dispatch({ type: "select", id: null });
        return;
      }

      if (!selectedId) return;

      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        dispatch({ type: "remove", id: selectedId });
        return;
      }

      // Arrow keys nudge by one device pixel; Shift jumps by ten.
      const step = event.shiftKey ? 10 : 1;
      const deltas: Record<string, [number, number]> = {
        arrowleft: [-step, 0],
        arrowright: [step, 0],
        arrowup: [0, -step],
        arrowdown: [0, step],
      };
      const delta = deltas[key];
      if (delta) {
        event.preventDefault();
        dispatch({ type: "nudge", id: selectedId, dx: delta[0], dy: delta[1] });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId]);

  return {
    doc,
    selected,
    selectedId: state.selectedId,
    dispatch,
    canUndo: canUndo(state.history),
    canRedo: canRedo(state.history),
  };
}
