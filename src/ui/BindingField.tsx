/**
 * "Where does this content come from?" -- the one control shared by text and
 * barcode inspectors.
 *
 * The stated worry about merge features is people not understanding their
 * variables or how they interact. The answer here is that a variable is never
 * typed as syntax into a text box: it is picked from a list, and the moment it
 * is picked the field shows the value from the record currently being
 * previewed. There is no placeholder language to learn and nothing that renders
 * as literal `{{name}}` on a printed label because of a typo.
 */

interface Props {
  /** Variable names available to bind to. */
  variables: readonly string[];
  /** Currently bound variable, if any. */
  binding: string | undefined;
  onChange: (binding: string | undefined) => void;
  valueLabel: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Render the literal input as a textarea, for multi-line text. */
  multiline?: boolean;
}

const LITERAL = "";

export function BindingField({
  variables,
  binding,
  onChange,
  valueLabel,
  value,
  onValueChange,
  multiline = false,
}: Props) {
  const bound = binding !== undefined && binding !== "";
  // A binding can outlive the dataset it came from -- the design is saved, the
  // CSV is not. Say so rather than silently showing it as fine.
  const orphaned = bound && !variables.includes(binding);

  return (
    <>
      {variables.length > 0 && (
        <label className="field">
          <span>Source</span>
          <select
            value={bound ? binding : LITERAL}
            onChange={(event) =>
              onChange(event.target.value === LITERAL ? undefined : event.target.value)
            }
          >
            <option value={LITERAL}>Fixed value</option>
            {variables.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
            {orphaned && <option value={binding}>{binding} (not in data)</option>}
          </select>
        </label>
      )}

      <label className="field">
        <span>{bound ? `${valueLabel} (from ${binding})` : valueLabel}</span>
        {multiline ? (
          <textarea
            rows={3}
            value={value}
            readOnly={bound}
            onChange={(event) => onValueChange(event.target.value)}
          />
        ) : (
          <input
            type="text"
            value={value}
            readOnly={bound}
            onChange={(event) => onValueChange(event.target.value)}
          />
        )}
        {bound && (
          <small>
            {orphaned
              ? `No column named "${binding}" in the loaded data. Showing the last value.`
              : "From the previewed record. Step through records to check others."}
          </small>
        )}
      </label>
    </>
  );
}
