/**
 * Inline text editing, overlaid on the canvas.
 *
 * A DOM textarea positioned and transformed to sit exactly where the Konva text
 * is, rather than an editor inside the canvas. Canvas has no text input, no
 * caret, no selection, and no IME support -- reimplementing those would be a
 * project. Borrowing the browser's gets all of it for free.
 *
 * The textarea mirrors the element's font, size, alignment and rotation so the
 * text does not visibly jump between editing and not editing.
 */

import { useEffect, useLayoutEffect, useRef } from "react";

import type { TextElement } from "../core/document.ts";

interface Props {
  element: TextElement;
  /** Display scale of the canvas, to convert label px to screen px. */
  scale: number;
  /** Workspace padding around the label, in label px, that the canvas adds. */
  offsetPx: number;
  onChange: (text: string) => void;
  onCommit: () => void;
}

export function InlineTextEditor({ element, scale, offsetPx, onChange, onCommit }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus();
    // Select everything: double-clicking a label to retype it is the common
    // case, and it costs one keypress to deselect.
    node.select();
  }, []);

  // Commit when focus moves anywhere else, including onto the canvas.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onCommit();
    };
    // Deferred so the double-click that opened the editor cannot immediately
    // close it.
    const timer = setTimeout(() => document.addEventListener("mousedown", onPointerDown), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [onCommit]);

  const fontStyle = [element.italic ? "italic" : "", element.bold ? "bold" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <textarea
      ref={ref}
      className="inline-text-editor"
      value={element.text}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        // Escape commits and closes; Enter inserts a newline, because labels
        // routinely carry multi-line addresses.
        if (event.key === "Escape") {
          event.preventDefault();
          onCommit();
        }
        // Keep editor shortcuts (delete, arrows, tool keys) out of the textarea.
        event.stopPropagation();
      }}
      style={{
        // Positioned in unscaled label coordinates, then scaled as a whole, so
        // the text lines up with the Konva rendering at any zoom.
        left: (element.x + offsetPx) * scale,
        top: (element.y + offsetPx) * scale,
        width: element.widthPx * scale,
        height: element.heightPx * scale,
        fontSize: element.fontSizePx * scale,
        fontFamily: element.fontFamily,
        fontStyle: fontStyle.includes("italic") ? "italic" : "normal",
        fontWeight: element.bold ? "bold" : "normal",
        textAlign: element.align,
        lineHeight: 1.2,
        // Rotate about the centre, matching the document model.
        transform: `rotate(${element.rotation}deg)`,
        transformOrigin: "center center",
      }}
    />
  );
}
