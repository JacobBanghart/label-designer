/**
 * Property panel for the selected element.
 *
 * Text edits are transient so that typing a sentence collapses into one undo
 * step per focus, not one per keystroke.
 */

import type { TextAlign, TextElement } from "../core/document.ts";
import type { EditorAction } from "../editor/store.ts";

interface Props {
  element: TextElement;
  dispatch: (action: EditorAction) => void;
}

const FONTS = ["sans-serif", "serif", "monospace"];
const ALIGNMENTS: TextAlign[] = ["left", "center", "right"];

export function Inspector({ element, dispatch }: Props) {
  const update = (patch: Partial<TextElement>, transient = false) =>
    dispatch({ type: "update", id: element.id, patch, transient });

  return (
    <div className="inspector">
      <h2>Text</h2>

      <label className="field">
        <span>Content</span>
        <textarea
          rows={4}
          value={element.text}
          onFocus={() => dispatch({ type: "beginGesture" })}
          onChange={(event) => update({ text: event.target.value }, true)}
        />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Size (px)</span>
          <input
            type="number"
            min={8}
            max={400}
            value={element.fontSizePx}
            onChange={(event) => update({ fontSizePx: Number(event.target.value) || 8 })}
          />
        </label>

        <label className="field">
          <span>Rotation</span>
          <input
            type="number"
            step={15}
            value={element.rotation}
            onChange={(event) => update({ rotation: Number(event.target.value) || 0 })}
          />
        </label>
      </div>

      <label className="field">
        <span>Font</span>
        <select
          value={element.fontFamily}
          onChange={(event) => update({ fontFamily: event.target.value })}
        >
          {FONTS.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>
      </label>

      <div className="field">
        <span>Align</span>
        <div className="segmented">
          {ALIGNMENTS.map((align) => (
            <button
              key={align}
              type="button"
              className={element.align === align ? "active" : ""}
              onClick={() => update({ align })}
            >
              {align}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Style</span>
        <div className="segmented">
          <button
            type="button"
            className={element.bold ? "active" : ""}
            onClick={() => update({ bold: !element.bold })}
          >
            Bold
          </button>
          <button
            type="button"
            className={element.italic ? "active" : ""}
            onClick={() => update({ italic: !element.italic })}
          >
            Italic
          </button>
        </div>
      </div>

      <div className="field">
        <span>Quick rotate</span>
        <div className="segmented">
          {[0, 90, 180, 270].map((deg) => (
            <button
              key={deg}
              type="button"
              className={element.rotation === deg ? "active" : ""}
              onClick={() => update({ rotation: deg })}
            >
              {deg}&deg;
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <button
          type="button"
          onClick={() => dispatch({ type: "reorder", id: element.id, direction: "backward" })}
        >
          Send back
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "reorder", id: element.id, direction: "forward" })}
        >
          Bring forward
        </button>
      </div>

      <button
        type="button"
        className="danger"
        onClick={() => dispatch({ type: "remove", id: element.id })}
      >
        Delete element
      </button>
    </div>
  );
}
