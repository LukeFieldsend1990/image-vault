/**
 * Skill resolver — maps triage output to applicable skills.
 * Pure function: no DB access, just category-to-skill mapping
 * with parameter pre-filling from structured data.
 *
 * Beyond the primary category, the resolver also scans action_items
 * for secondary intents (e.g. an onboarding ask inside a licence_request email).
 */

import type { SkillSuggestion } from "./types";
import type { SkillDefinition } from "./types";
import { getSkillsByCategory, getSkill } from "./registry";

// Ensure all skills are registered before resolving
import "./definitions";

/** Patterns that signal a secondary intent in action item text */
const ACTION_ITEM_SIGNALS: Array<{ pattern: RegExp; skillId: string }> = [
  { pattern: /\bonboard\b/i, skillId: "send-signup-invite" },
  { pattern: /\binvite\b/i, skillId: "send-signup-invite" },
  { pattern: /\bsign[- ]?up\b/i, skillId: "send-signup-invite" },
  { pattern: /\bcreate\s+(an?\s+)?account\b/i, skillId: "send-signup-invite" },
  { pattern: /\bregister\b/i, skillId: "send-signup-invite" },
];

/** Try to extract an email address from a string */
function extractEmail(text: string): string | null {
  const match = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
  return match ? match[0] : null;
}

/** Infer a role from action item text */
function inferRole(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(talent|actor|artist|performer)\b/.test(lower)) return "talent";
  if (/\b(rep|agent|agency)\b/.test(lower)) return "rep";
  if (/\b(licensee|production|studio|company)\b/.test(lower)) return "licensee";
  return null;
}

function prefillSkill(
  skill: SkillDefinition,
  category: string,
  structuredData: Record<string, unknown>,
  fromEmail?: string,
  actionItemHint?: { email?: string; role?: string }
): Record<string, unknown> {
  const prefilled: Record<string, unknown> = {};

  switch (skill.id) {
    case "send-signup-invite": {
      // Prefer email extracted from the action item, then fromEmail, then people_mentioned
      if (actionItemHint?.email) {
        prefilled.email = actionItemHint.email;
      } else if (fromEmail) {
        prefilled.email = fromEmail;
      } else {
        const people = structuredData.people_mentioned;
        if (Array.isArray(people) && typeof people[0] === "string") {
          prefilled.email = people[0];
        }
      }
      // Role from action item hint, then from category
      if (actionItemHint?.role) {
        prefilled.role = actionItemHint.role;
      } else if (category === "onboarding") {
        prefilled.role = "talent";
      } else if (category === "introduction") {
        prefilled.role = "licensee";
      }
      break;
    }

    case "find-package": {
      if (typeof structuredData.production_name === "string") {
        prefilled.package_name = structuredData.production_name;
      }
      if (typeof structuredData.talent_name === "string") {
        prefilled.talent_name = structuredData.talent_name;
      }
      break;
    }

    case "find-licence": {
      if (typeof structuredData.talent_name === "string") {
        prefilled.talent_name = structuredData.talent_name;
      }
      if (typeof structuredData.production_name === "string") {
        prefilled.production_name = structuredData.production_name;
      }
      if (typeof structuredData.company_name === "string") {
        prefilled.company_name = structuredData.company_name;
      }
      if (typeof structuredData.licence_type === "string") {
        prefilled.licence_type = structuredData.licence_type;
      }
      break;
    }
  }

  return prefilled;
}

export function resolveSkills(
  category: string,
  structuredData: Record<string, unknown>,
  confidence: number,
  fromEmail?: string
): SkillSuggestion[] {
  const seen = new Set<string>();
  const suggestions: SkillSuggestion[] = [];

  // 1. Primary: skills matched by triage category
  const primarySkills = getSkillsByCategory(category);
  for (const skill of primarySkills) {
    seen.add(skill.id);
    suggestions.push({
      skillId: skill.id,
      displayName: skill.name,
      description: skill.description,
      prefilled: prefillSkill(skill, category, structuredData, fromEmail),
      confidence,
    });
  }

  // 2. Secondary: scan action_items for intents not covered by the primary category
  const actionItems = structuredData.action_items;
  if (Array.isArray(actionItems)) {
    for (const item of actionItems) {
      if (typeof item !== "string") continue;

      for (const signal of ACTION_ITEM_SIGNALS) {
        if (seen.has(signal.skillId)) continue;
        if (!signal.pattern.test(item)) continue;

        const skill = getSkill(signal.skillId);
        if (!skill) continue;

        seen.add(signal.skillId);

        const hint: { email?: string; role?: string } = {};
        const emailInItem = extractEmail(item);
        if (emailInItem) hint.email = emailInItem;
        const roleInItem = inferRole(item);
        if (roleInItem) hint.role = roleInItem;

        suggestions.push({
          skillId: skill.id,
          displayName: skill.name,
          description: skill.description,
          prefilled: prefillSkill(skill, category, structuredData, fromEmail, hint),
          confidence: Math.max(confidence * 0.8, 0.4), // slightly lower for secondary
        });
      }
    }
  }

  return suggestions;
}
