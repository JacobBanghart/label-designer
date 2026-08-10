/**
 * Property panel for image elements.
 *
 * The halftone choice is the only setting that really matters, and it is worth
 * explaining rather than labelling: users do not arrive knowing that a
 * photograph and a logo need different 1-bit treatments.
 */

import type { HalftoneMode, ImageElement } from "../core/document.ts";
import type { EditorAction } from "../editor/store.ts";

interface Props {
  element: ImageElement;
  dispatch: (action: EditorAction) => void;
}

const MODES: { mode: HalftoneMode; label: string; hint: string }[] = [
  { mode: "threshold", label: "Line art", hint: "Hard black and white. Best for logos and text." },
  { mode: "dither", label: "Photo", hint: "Dithered grey simulation. Best for photographs." },
];

export function ImageInspector({ element, dispatch }: Props) {
  const update = (patch: Partial<ImageElement>) =>
    dispatch({ type: "update", id: element.id, patch });

  const active = MODES.find((m) => m.mode === element.halftone);

  return (
    <div className="inspector">
      <h2>Image</h2>

      <div className="field">
        <span>Rendering</span>
        <div className="segmented">
          {MODES.map(({ mode, label }) => (
            <button
              key={mode}
              type="button"
              className={element.halftone === mode ? "active" : ""}
              onClick={() => update({ halftone: mode })}
            >
              {label}
            </button>
          ))}
        </div>
        {active && <p className="hint">{active.hint}</p>}
      </div>

      {element.halftone === "threshold" && (
        <label className="field">
          <span>Threshold ({element.threshold})</span>
          <input
            type="range"
            min={1}
            max={254}
            value={element.threshold}
            onChange={(event) => update({ threshold: Number(event.target.value) })}
          />
        </label>
      )}

      <div className="field">
        <span>Invert</span>
        <div className="segmented">
          <button
            type="button"
            className={!element.invert ? "active" : ""}
            onClick={() => update({ invert: false })}
          >
            Normal
          </button>
          <button
            type="button"
            className={element.invert ? "active" : ""}
            onClick={() => update({ invert: true })}
          >
            Inverted
          </button>
        </div>
      </div>

      <label className="field">
        <span>Rotation</span>
        <input
          type="number"
          step={15}
          value={element.rotation}
          onChange={(event) => update({ rotation: Number(event.target.value) || 0 })}
        />
      </label>

      <p className="hint">
        Turn on the 1-bit preview to see what actually prints &mdash; the canvas shows the original
        image, not the halftoned result.
      </p>

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
