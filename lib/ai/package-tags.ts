import type { drizzle } from "drizzle-orm/d1";
import { scanPackages, scanFiles, talentProfiles, packageTags } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { callAi } from "./providers";
import { isAiEnabled } from "./cost-tracker";
import { METADATA_TAG_PROMPT, ALL_TAGS, TAG_VOCABULARY } from "./constants";

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

export async function suggestPackageTags(
  env: { AI?: Ai; ANTHROPIC_API_KEY?: string },
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
    })
    .from(scanPackages)
    .where(eq(scanPackages.id, packageId))
    .get();

  if (!pkg) return;

  // Get file manifest
  const files = await db
    .select({
      filename: scanFiles.filename,
      sizeBytes: scanFiles.sizeBytes,
      contentType: scanFiles.contentType,
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

  if (!result) return;

  const tags = parseTagResponse(result.text);
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
