/**
 * The unit lengths are shown in.
 *
 * A UI preference, deliberately NOT part of the document: two people opening
 * the same label should each see their own preferred unit, and switching units
 * must never touch stored geometry.
 */

import { useEffect, useState } from "react";

import { DISPLAY_UNITS, type DisplayUnit } from "../core/units.ts";

const KEY = "label-designer:unit";

function readStored(): DisplayUnit {
  try {
    const raw = localStorage.getItem(KEY);
    return DISPLAY_UNITS.includes(raw as DisplayUnit) ? (raw as DisplayUnit) : "in";
  } catch {
    return "in";
  }
}

export function useDisplayUnit(): [DisplayUnit, (unit: DisplayUnit) => void] {
  const [unit, setUnit] = useState<DisplayUnit>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, unit);
    } catch {
      // A lost preference is not worth surfacing.
    }
  }, [unit]);

  return [unit, setUnit];
}
