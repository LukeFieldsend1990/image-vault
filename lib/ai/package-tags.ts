import type { drizzle } from "drizzle-orm/d1";
import { scanPackages, scanFiles, talentProfiles, packageTags, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { callAi, callVisionAi } from "./providers";
import { logAiCost, isAiEnabled, getSettingValue } from "./cost-tracker";
import { METADATA_TAG_PROMPT, IMAGE_ANALYSIS_PROMPT, ALL_TAGS, TAG_VOCABULARY } from "./constants";

type Db = ReturnType<typeof drizzle>;

interface TagSuggestion {
  tag: string;
  category: string;
}

const VALID_CATEGORIES = new Set(Object.keys(TAG_VOCABULARY));

function parseTagResponse(text: string): TagSuggestion[] {
  const trimmed = text.trim();
  let jsonStr = trimmed;

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1].trim();

  const start = jsonStr.indexOf("[");
  const end = jsonStr.lastIndexOf("]");
  if (start === -1 || end === -1) return [];

  try {
    const arr = JSON.parse(jsonStr.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];

    return arr.filter(
      (item): item is TagSuggestion =>
        typeof item === "object" &&
        item !== null &&
        typeof item.tag === "string" &&
        typeof item.category === "string" &&
        ALL_TAGS.has(item.tag) &&
        VALID_CATEGORIES.has(item.category)
    );
  } catch {
    return [];
  }
}

const IMAGE_CONTENT_TYPES = new Set(["image/jpeg", "image/png"]);
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB limit for vision model
const MIN_IMAGE_BYTES = 50 * 1024; // skip thumbnails < 50 KB
const DEFAULT_MAX_IMAGES = 3;

// Filename patterns that indicate high-value reference images, ranked by priority.
// Each bucket targets a different body region / angle so we get diverse coverage.
const IMAGE_PRIORITY_HINTS: [RegExp, string][] = [
  [/front(al)?[_\-\s]?neutral/i, "frontal"],
  [/face[_\-\s]?(detail|closeup|close)/i, "face"],
  [/full[_\-\s]?body/i, "full_body"],
  [/profile|side[_\-\s]?view/i, "profile"],
  [/three[_\-\s]?quarter|3_?4/i, "three_quarter"],
  [/hand|hands/i, "hands"],
  [/neutral|ref(erence)?/i, "neutral"],
];

// Names that indicate non-useful images for tagging
const SKIP_PATTERNS = /thumb(nail)?|preview|icon|_sm\b|_xs\b|plate[_\-]?\d/i;

type ImageFile = { filename: string; contentType: string | null; r2Key: string | null; sizeBytes: number | null };

function selectRepresentativeImages(
  images: ImageFile[],
  coverImageKey: string | null,
  maxImages: number,
): ImageFile[] {
  const selected: ImageFile[] = [];
  const usedKeys = new Set<string>();

  // 1. Always include the cover image if it's in the file list
  if (coverImageKey) {
    const cover = images.find((f) => f.r2Key === coverImageKey);
    if (cover) {
      selected.push(cover);
      usedKeys.add(cover.r2Key!);
    }
  }

  // 2. Pick one image per priority bucket for diverse coverage
  const usedBuckets = new Set<string>();
  for (const [pattern, bucket] of IMAGE_PRIORITY_HINTS) {
    if (selected.length >= maxImages) break;
    if (usedBuckets.has(bucket)) continue;

    const match = images.find(
      (f) => !usedKeys.has(f.r2Key!) && pattern.test(f.filename)
    );
    if (match) {
      selected.push(match);
      usedKeys.add(match.r2Key!);
      usedBuckets.add(bucket);
    }
  }

  // 3. If still under limit, fill with the largest remaining images (more detail = better)
  if (selected.length < maxImages) {
    const remaining = images
      .filter((f) => !usedKeys.has(f.r2Key!))
      .sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0));

    for (const f of remaining) {
      if (selected.length >= maxImages) break;
      selected.push(f);
    }
  }

  return selected;
}

async function analyseImages(
  ai: Ai,
  db: Db,
  bucket: R2Bucket,
  files: ImageFile[],
  coverImageKey: string | null,
  maxImages: number,
): Promise<TagSuggestion[]> {
  // Filter to real images: right type, right size range, skip thumbnails/plates
  const imageFiles = files.filter(
    (f) =>
      f.r2Key &&
      f.contentType &&
      IMAGE_CONTENT_TYPES.has(f.contentType) &&
      (f.sizeBytes ?? 0) <= MAX_IMAGE_BYTES &&
      (f.sizeBytes ?? 0) >= MIN_IMAGE_BYTES &&
      !SKIP_PATTERNS.test(f.filename)
  );

  if (imageFiles.length === 0) return [];

  const toAnalyse = selectRepresentativeImages(imageFiles, coverImageKey, maxImages);

  const allTags: TagSuggestion[] = [];

  for (const file of toAnalyse) {
    try {
      const obj = await bucket.get(file.r2Key!);
      if (!obj) continue;

      const bytes = new Uint8Array(await obj.arrayBuffer());
      const result = await callVisionAi(ai, {
        imageBytes: bytes,
        prompt: IMAGE_ANALYSIS_PROMPT,
      });

      await logAiCost(db, {
        provider: "workers_ai",
        model: "@cf/llava-hf/llava-1.5-7b-hf",
        feature: "metadata_tags_vision",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        estimatedCostUsd: 0,
        prompt: `[image: ${file.filename}]`,
        response: result.text.slice(0, 4000),
      });

      const tags = parseTagResponse(result.text);
      allTags.push(...tags);
    } catch {
      // Vision analysis failure should not block manifest tagging
      continue;
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  return allTags.filter((t) => {
    const key = `${t.category}:${t.tag}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function suggestPackageTags(
  env: { AI?: Ai; ANTHROPIC_API_KEY?: string; SCANS_BUCKET?: R2Bucket },
  db: Db,
  packageId: string
): Promise<void> {
  const enabled = await isAiEnabled(db);
  if (!enabled) return;

  // Get package details
  const pkg = await db
    .select({
      id: scanPackages.id,
      talentId: scanPackages.talentId,
      name: scanPackages.name,
      description: scanPackages.description,
      studioName: scanPackages.studioName,
      technicianNotes: scanPackages.technicianNotes,
      totalSizeBytes: scanPackages.totalSizeBytes,
      coverImageKey: scanPackages.coverImageKey,
    })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg) return;

  // Check if AI is disabled for the talent who owns this package
  const talent = await db
    .select({ aiDisabled: users.aiDisabled })
    .from(users)
    .where(eq(users.id, pkg.talentId))
    .get();
  if (talent?.aiDisabled) return;

  // Get file manifest (include r2Key for image analysis)
  const files = await db
    .select({
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      contentType: scanFiles.contentType,
      r2Key: scanFiles.r2Key,
    })
    .from(scanFiles)
    .where(and(eq(scanFiles.packageId, packageId), eq(scanFiles.uploadStatus, "complete")))
    .all();

  if (files.length === 0) return;

  // Get talent profile for context
  const profile = await db
    .select({ fullName: talentProfiles.fullName })
    .from(talentProfiles)
    .where(eq(talentProfiles.userId, pkg.talentId))
    .get();

  const manifest = {
    packageName: pkg.name,
    description: pkg.description,
    studioName: pkg.studioName,
    technicianNotes: pkg.technicianNotes,
    totalSizeBytes: pkg.totalSizeBytes,
    talentName: profile?.fullName,
    files: files.map((f) => ({
      filename: f.filename,
      sizeBytes: f.sizeBytes,
      contentType: f.contentType,
    })),
  };

  const result = await callAi(env, db, {
    feature: "metadata_tags",
    requiresReasoning: false,
    system: METADATA_TAG_PROMPT,
    userMessage: JSON.stringify(manifest),
  });

  const manifestTags = result ? parseTagResponse(result.text) : [];

  // Run image analysis if R2 bucket and AI binding are available
  let visionTags: TagSuggestion[] = [];
  if (env.AI && env.SCANS_BUCKET) {
    const maxImagesRaw = await getSettingValue(db, "vision_max_images");
    const maxImages = Math.max(1, Math.min(20, parseInt(maxImagesRaw ?? "", 10) || DEFAULT_MAX_IMAGES));
    visionTags = await analyseImages(env.AI, db, env.SCANS_BUCKET, files, pkg.coverImageKey ?? null, maxImages);
  }

  // Merge manifest tags with vision tags (manifest takes precedence)
  const seenKeys = new Set(manifestTags.map((t) => `${t.category}:${t.tag}`));
  const tags = [
    ...manifestTags,
    ...visionTags.filter((t) => !seenKeys.has(`${t.category}:${t.tag}`)),
  ];

  if (tags.length === 0) return;

  const now = Math.floor(Date.now() / 1000);

  // Check for existing tags to avoid duplicates
  const existingTags = await db
    .select({ tag: packageTags.tag })
    .from(packageTags)
    .where(eq(packageTags.packageId, packageId))
    .all();
  const existingSet = new Set(existingTags.map((t) => t.tag));

  for (const t of tags) {
    if (existingSet.has(t.tag)) continue;

    await db.insert(packageTags).values({
      id: crypto.randomUUID(),
      packageId,
      tag: t.tag,
      category: t.category,
      status: "suggested",
      suggestedBy: "ai",
      reviewedBy: null,
      reviewedAt: null,
      createdAt: now,
    });
  }
}
