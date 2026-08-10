/**
 * Property panel for barcodes.
 *
 * Symbology, error correction and the caption are DESIGN. The value is DATA,
 * and can come either from this box or from a merge variable. Keeping that line
 * visible in the UI is what makes "bind a barcode to a column" comprehensible
 * rather than magic.
 *
 * Any problem with the current value is reported here in full. A barcode is the
 * one element that refuses to print rather than degrading, so the reason has to
 * be somewhere the user will actually look.
 */

import {
  layoutBarcode,
  SYMBOLOGIES,
  SYMBOLOGY_LABELS,
  type QrEcc,
  type Symbology,
} from "../core/barcode/index.ts";
import type { BarcodeElement } from "../core/document.ts";
import type { DisplayUnit } from "../core/units.ts";
import type { EditorAction } from "../editor/store.ts";
import { GeometryFields } from "./GeometryFields.tsx";
import { BindingField } from "./BindingField.tsx";

interface Props {
  element: BarcodeElement;
  unit: DisplayUnit;
  dpi: number;
  /** Variable names available to bind to. */
  variables: readonly string[];
  dispatch: (action: EditorAction) => void;
}

const ECC_LEVELS: { value: QrEcc; label: string }[] = [
  { value: "L", label: "L - 7%" },
  { value: "M", label: "M - 15%" },
  { value: "Q", label: "Q - 25%" },
  { value: "H", label: "H - 30%" },
];

export function BarcodeInspector({ element, unit, dpi, variables, dispatch }: Props) {
  const update = (patch: Partial<BarcodeElement>) =>
    dispatch({ type: "update", id: element.id, patch });

  const result = layoutBarcode(
    { symbology: element.symbology, value: element.value, ecc: element.ecc },
    { widthPx: element.widthPx, heightPx: element.heightPx },
  );

  return (
    <div className="inspector">
      <h2>Barcode</h2>

      <label className="field">
        <span>Symbology</span>
        <select
          value={element.symbology}
          onChange={(event) => update({ symbology: event.target.value as Symbology })}
        >
          {SYMBOLOGIES.map((s) => (
            <option key={s} value={s}>
              {SYMBOLOGY_LABELS[s]}
            </option>
          ))}
        </select>
      </label>

      <BindingField
        variables={variables}
        binding={element.binding}
        onChange={(binding) => update({ binding })}
        valueLabel="Value"
        value={element.value}
        onValueChange={(value) => update({ value })}
      />

      {element.symbology === "qr" && (
        <label className="field">
          <span>Error correction</span>
          <select
            value={element.ecc}
            onChange={(event) => update({ ecc: event.target.value as QrEcc })}
          >
            {ECC_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
          <small>Higher survives more scuffing, but holds less data.</small>
        </label>
      )}

      {element.symbology !== "qr" && (
        <label className="field-check">
          <input
            type="checkbox"
            checked={element.showText}
            onChange={(event) => update({ showText: event.target.checked })}
          />
          <span>Print the value underneath</span>
        </label>
      )}

      {result.ok ? (
        <p className="hint">
          {result.layout.moduleSizePx} px per module.
          {result.layout.moduleSizePx < 2 && " Enlarge the box if it scans poorly."}
        </p>
      ) : (
        <p className="warning">Will not print: {result.error}</p>
      )}

      <GeometryFields element={element} unit={unit} dpi={dpi} dispatch={dispatch} />
    </div>
  );
}
