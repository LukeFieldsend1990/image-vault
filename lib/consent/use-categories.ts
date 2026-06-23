// Canonical use-category taxonomy (ONBOARDING-POC-GAPS-SPEC §2).
//
// A single stable vocabulary that consent documents, licence terms, and
// standing instructions all reference by id. Code-defined — like the skills
// (lib/skills) and compliance (lib/compliance) registries — so it is type-safe
// with zero DB cold-start cost. If categories ever need to vary per
// regime/agreement, promote this to a `useCategories` table; until then it
// lives here and is the one source of truth.

export interface UseCategory {
  /** Stable identifier referenced by consent, licences, and standing instructions. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** One-line description of what the category covers. */
  description: string;
  /** Plain-English example shown to performers. */
  example: string;
  /** Legal regime section this use falls under, if any (e.g. "§39G"). */
  regimeTag: string | null;
  /** Sensitive uses (replica creation, AI training) warrant extra consent friction. */
  sensitive: boolean;
}

export const USE_CATEGORIES = [
  {
    id: "vfx-this",
    name: "VFX work on this production",
    description: "Visual-effects work using the scan on the production it was captured for.",
    example: "De-aging, stunt-double composites, or crowd tiles for the film being shot.",
    regimeTag: null,
    sensitive: false,
  },
  {
    id: "reuse",
    name: "Re-use on later productions",
    description: "Re-using the scan on a different, later production.",
    example: "Bringing your character back for a sequel or a spin-off series.",
    regimeTag: null,
    sensitive: false,
  },
  {
    id: "dub",
    name: "Dubbing and localisation",
    description: "Lip-sync and localisation of existing footage into other languages.",
    example: "Re-voicing your scenes into French or Japanese with matching mouth movement.",
    regimeTag: "§39D",
    sensitive: false,
  },
  {
    id: "replica",
    name: "Digital replica creation",
    description: "Creating a digital replica of your likeness.",
    example: "Building a photoreal digital double that can perform actions you never filmed.",
    regimeTag: "§39E",
    sensitive: true,
  },
  {
    id: "training",
    name: "Training data for generative AI",
    description: "Using the scan as training data for generative-AI models.",
    example: "Feeding your scan into a model that learns to generate new faces or performances.",
    regimeTag: "§39G",
    sensitive: true,
  },
  {
    id: "marketing",
    name: "Marketing and promotion",
    description: "Using the likeness in marketing and promotional materials.",
    example: "Posters, trailers, social-media cut-downs, and press imagery.",
    regimeTag: null,
    sensitive: false,
  },
] as const satisfies readonly UseCategory[];

export type UseCategoryId = (typeof USE_CATEGORIES)[number]["id"];

/** The category the legacy `permitAiTraining` boolean maps to (§39G). */
export const TRAINING_USE_CATEGORY_ID: UseCategoryId = "training";

const BY_ID = new Map<string, UseCategory>(USE_CATEGORIES.map((c) => [c.id, c]));

export function listUseCategories(): readonly UseCategory[] {
  return USE_CATEGORIES;
}

export function getUseCategory(id: string): UseCategory | undefined {
  return BY_ID.get(id);
}

export function isUseCategoryId(id: unknown): id is UseCategoryId {
  return typeof id === "string" && BY_ID.has(id);
}

/**
 * Filter arbitrary input down to the valid, de-duplicated set of category ids,
 * preserving canonical (taxonomy) order. Unknown ids are dropped — callers that
 * want to reject unknown ids instead should check `isUseCategoryId` first.
 */
export function normaliseUseCategoryIds(input: unknown): UseCategoryId[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<UseCategoryId>();
  for (const v of input) {
    if (isUseCategoryId(v)) seen.add(v);
  }
  return USE_CATEGORIES.filter((c) => seen.has(c.id)).map((c) => c.id);
}

/** Serialize category ids for a `*_categories_json` text column (null when empty). */
export function serializeUseCategoryIds(input: unknown): string | null {
  const ids = normaliseUseCategoryIds(input);
  return ids.length ? JSON.stringify(ids) : null;
}

/** Parse a `*_categories_json` text column back into validated category ids. */
export function parseUseCategoryIds(json: string | null | undefined): UseCategoryId[] {
  if (!json) return [];
  try {
    return normaliseUseCategoryIds(JSON.parse(json));
  } catch {
    return [];
  }
}

/**
 * Keep the legacy `permitAiTraining` boolean and the `training` (§39G) category
 * in sync so the two can't drift. AI-training-permitted is true if *either*
 * side says so, and that truth is reflected back into both:
 *
 *   - permitAiTraining true  → ensure `training` is in the category list
 *   - `training` in the list → permitAiTraining is true
 */
export function reconcileTrainingFlag(opts: {
  useCategoryIds?: readonly string[] | null;
  permitAiTraining?: boolean | null;
}): { useCategoryIds: UseCategoryId[]; permitAiTraining: boolean } {
  const ids = normaliseUseCategoryIds(opts.useCategoryIds ?? []);
  const hasTraining = ids.includes(TRAINING_USE_CATEGORY_ID);
  const permitAiTraining = opts.permitAiTraining === true || hasTraining;
  if (permitAiTraining && !hasTraining) {
    return {
      useCategoryIds: normaliseUseCategoryIds([...ids, TRAINING_USE_CATEGORY_ID]),
      permitAiTraining: true,
    };
  }
  return { useCategoryIds: ids, permitAiTraining };
}
