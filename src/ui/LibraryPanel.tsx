/**
 * The saved-labels list.
 *
 * Switching labels is a destructive-feeling action, so the current design is
 * always written to storage before loading another one -- there is no explicit
 * "save" button to forget to press.
 */

import { useState } from "react";

import type { LabelDocument } from "../core/document.ts";
import { sortedEntries, type Library } from "../storage/library.ts";

interface Props {
  library: Library;
  activeId: string;
  onOpen: (doc: LabelDocument) => void;
  onNew: () => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

export function LibraryPanel({
  library,
  activeId,
  onOpen,
  onNew,
  onDuplicate,
  onDelete,
  onReorder,
}: Props) {
  const entries = sortedEntries(library);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  /** Move `draggingId` to sit where `targetId` currently is. */
  function dropOn(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    const ids = entries.map((e) => e.doc.id);
    const from = ids.indexOf(draggingId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    onReorder(ids);
  }

  return (
    <div className="library">
      <h2>Labels</h2>

      <div className="field-row">
        <button type="button" onClick={onNew}>
          New
        </button>
        <button type="button" onClick={onDuplicate}>
          Duplicate
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="hint">No saved labels yet.</p>
      ) : (
        <ul className="library-list">
          {entries.map(({ doc, updatedAt }) => (
            <li
              key={doc.id}
              className={[
                doc.id === activeId ? "active" : "",
                doc.id === draggingId ? "dragging" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable
              onDragStart={() => setDraggingId(doc.id)}
              onDragEnd={() => setDraggingId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                dropOn(doc.id);
                setDraggingId(null);
              }}
            >
              <button type="button" className="open" onClick={() => onOpen(doc)}>
                <span className="name">{doc.name || "Untitled label"}</span>
                <span className="meta">
                  {doc.sizeId} {doc.orientation === "landscape" ? "↔" : "↕"} &middot;{" "}
                  {doc.elements.length} {doc.elements.length === 1 ? "element" : "elements"}
                  {updatedAt > 0 && ` · ${relativeTime(updatedAt)}`}
                </span>
              </button>
              <button
                type="button"
                className="remove"
                aria-label={`Delete ${doc.name}`}
                onClick={() => onDelete(doc.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {entries.length > 1 && <p className="hint">Drag to reorder.</p>}
    </div>
  );
}

/** Coarse relative time. Precision beyond "which one did I just touch" is noise. */
function relativeTime(epochMillis: number): string {
  const seconds = Math.round((Date.now() - epochMillis) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
