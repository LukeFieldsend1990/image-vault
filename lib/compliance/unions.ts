// First-party union registry (SPEC §16 — compliance roles).
//
// Unions are NOT organisations: the organisations table models commercial
// counterparties (production companies, studios, vendors) that license likeness.
// A union is an oversight body, so it lives here as a first-party preset keyed to
// the regime that defines its obligations (lib/compliance/regimes) and to the
// production flag that marks a title as falling under it (productions.is_sag /
// is_equity). Two presets are seeded — SAG-AFTRA and Equity — mirroring the
// in-memory, code-defined pattern used by skills and regimes (zero cold-start,
// type-safe). Add a union by adding a preset here and its regime under regimes/.

import type { RegimeId } from "./types";

export type UnionId = "sag_aftra" | "equity";

export interface UnionPreset {
  /** Stable id — shares the value of the regime that defines this union's obligations. */
  id: UnionId;
  /** Full legal name. */
  name: string;
  /** Short display name used across the UI. */
  shortName: string;
  jurisdiction: string;
  /** The compliance regime whose obligations apply to productions under this union. */
  regimeId: RegimeId;
  /** The productions boolean column that marks a title as falling under this union. */
  productionFlag: "isSag" | "isEquity";
  description: string;
}

export const UNION_PRESETS: readonly UnionPreset[] = [
  {
    id: "sag_aftra",
    name: "Screen Actors Guild – American Federation of Television and Radio Artists",
    shortName: "SAG-AFTRA",
    jurisdiction: "United States",
    regimeId: "sag_aftra",
    productionFlag: "isSag",
    description:
      "US performers' union. Article 39 (AI / digital-replica) obligations apply to productions flagged SAG-AFTRA.",
  },
  {
    id: "equity",
    name: "British Actors' Equity Association",
    shortName: "Equity",
    jurisdiction: "United Kingdom",
    regimeId: "equity",
    productionFlag: "isEquity",
    description:
      "UK performers' union. Digital-likeness / AI obligations apply to productions flagged Equity.",
  },
] as const;

export function listUnionPresets(): readonly UnionPreset[] {
  return UNION_PRESETS;
}

export function getUnionPreset(id: string): UnionPreset | undefined {
  return UNION_PRESETS.find((u) => u.id === id);
}

/** Map a regime id back to its union preset, if that regime represents a union. */
export function unionForRegime(regimeId: string): UnionPreset | undefined {
  return UNION_PRESETS.find((u) => u.regimeId === regimeId);
}
