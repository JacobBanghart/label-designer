/**
 * Panel shown when more than one element is selected.
 *
 * Per-element properties are deliberately absent: editing "stroke width" across
 * a text element and an image means inventing rules about what applies to what.
 * Alignment is the thing that genuinely needs several elements.
 */

import type { Element } from "../core/document.ts";
import type { AlignEdge, DistributeAxis } from "../editor/align.ts";
import type { EditorAction } from "../editor/store.ts";

interface Props {
  elements: readonly Element[];
  dispatch: (action: EditorAction) => void;
}

const HORIZONTAL: { edge: AlignEdge; label: string }[] = [
  { edge: "left", label: "Left" },
  { edge: "centreX", label: "Centre" },
  { edge: "right", label: "Right" },
];

const VERTICAL: { edge: AlignEdge; label: string }[] = [
  { edge: "top", label: "Top" },
  { edge: "centreY", label: "Middle" },
  { edge: "bottom", label: "Bottom" },
];

const AXES: { axis: DistributeAxis; label: string }[] = [
  { axis: "horizontal", label: "Horizontally" },
  { axis: "vertical", label: "Vertically" },
];

export function MultiInspector({ elements, dispatch }: Props) {
  const canDistribute = elements.length >= 3;

  return (
    <div className="inspector">
      <h2>{elements.length} selected</h2>

      <div className="field">
        <span>Align horizontally</span>
        <div className="segmented">
          {HORIZONTAL.map(({ edge, label }) => (
            <button key={edge} type="button" onClick={() => dispatch({ type: "align", edge })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Align vertically</span>
        <div className="segmented">
          {VERTICAL.map(({ edge, label }) => (
            <button key={edge} type="button" onClick={() => dispatch({ type: "align", edge })}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Distribute</span>
        <div className="segmented">
          {AXES.map(({ axis, label }) => (
            <button
              key={axis}
              type="button"
              disabled={!canDistribute}
              onClick={() => dispatch({ type: "distribute", axis })}
            >
              {label}
            </button>
          ))}
        </div>
        {!canDistribute && <p className="hint">Select three or more to distribute.</p>}
      </div>

      <div className="field-row">
        <button
          type="button"
          onClick={() => {
            for (const element of elements) dispatch({ type: "duplicate", id: element.id });
          }}
        >
          Duplicate all
        </button>
      </div>

      <button
        type="button"
        className="danger"
        onClick={() => {
          for (const element of elements) dispatch({ type: "remove", id: element.id });
        }}
      >
        Delete {elements.length} elements
      </button>
    </div>
  );
}
