/**
 * Skill resolver — maps triage output to applicable skills.
 * Pure function: no DB access, just category-to-skill mapping
 * with parameter pre-filling from structured data.
 */

import type { SkillSuggestion } from "./types";
import { getSkillsByCategory } from "./registry";

// Ensure all skills are registered before resolving
import "./definitions";

export function resolveSkills(
  category: string,
  structuredData: Record<string, unknown>,
  confidence: number,
  fromEmail?: string
): SkillSuggestion[] {
  const skills = getSkillsByCategory(category);
  if (skills.length === 0) return [];

  const suggestions: SkillSuggestion[] = [];

  for (const skill of skills) {
    const prefilled: Record<string, unknown> = {};

    switch (skill.id) {
      case "send-signup-invite": {
        // Pre-fill email from the sender or first person mentioned
        const people = structuredData.people_mentioned;
        if (fromEmail) {
          prefilled.email = fromEmail;
        } else if (Array.isArray(people) && typeof people[0] === "string") {
          prefilled.email = people[0];
        }
        // Default role based on context
        if (category === "onboarding") {
          prefilled.role = "talent";
        } else if (category === "introduction") {
          prefilled.role = "licensee";
        }
        break;
      }

      case "find-package": {
        // Pre-fill from production name (often the package name) and talent
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

    suggestions.push({
      skillId: skill.id,
      displayName: skill.name,
      description: skill.description,
      prefilled,
      confidence,
    });
  }

  return suggestions;
}
