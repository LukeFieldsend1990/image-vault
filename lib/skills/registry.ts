/**
 * In-memory skill registry.
 * Skills self-register via registerSkill(). The catalogue is code-defined,
 * not database-backed, so adding a new skill is just a new file + import.
 */

import type { SkillDefinition } from "./types";

const skills = new Map<string, SkillDefinition>();

export function registerSkill(skill: SkillDefinition): void {
  skills.set(skill.id, skill);
}

export function getSkill(id: string): SkillDefinition | undefined {
  return skills.get(id);
}

export function getAllSkills(): SkillDefinition[] {
  return Array.from(skills.values());
}

export function getSkillsByCategory(category: string): SkillDefinition[] {
  return Array.from(skills.values()).filter((s) =>
    s.categories.includes(category)
  );
}
