import { registerSkill } from "../registry";
import type { SkillDefinition } from "../types";
import { licences, scanPackages, users } from "@/lib/db/schema";
import { eq, and, like, or, desc } from "drizzle-orm";

const skill: SkillDefinition = {
  id: "find-licence",
  name: "Find Licence Details",
  description: "Look up licence records and generate a direct link for the licensee view",
  categories: ["clarification", "billing"],
  parameters: [
    {
      name: "talent_name",
      type: "string",
      description: "Name of the talent associated with the licence",
      required: false,
    },
    {
      name: "production_name",
      type: "string",
      description: "Name of the production or project",
      required: false,
    },
    {
      name: "company_name",
      type: "string",
      description: "Name of the production company",
      required: false,
    },
    {
      name: "licence_type",
      type: "select",
      description: "Type of licence",
      required: false,
      options: [
        "film_double",
        "game_character",
        "commercial",
        "ai_avatar",
        "training_data",
        "monitoring_reference",
      ],
    },
  ],

  async execute(ctx, params) {
    const { session, db } = ctx;

    const talentName = (params.talent_name as string)?.trim();
    const productionName = (params.production_name as string)?.trim();
    const companyName = (params.company_name as string)?.trim();
    const licenceType = (params.licence_type as string)?.trim();

    if (!talentName && !productionName && !companyName && !licenceType) {
      return { success: false, message: "At least one search parameter is required." };
    }

    // Build WHERE conditions
    const conditions: ReturnType<typeof like>[] = [];

    function sanitise(s: string): string {
      return s.replace(/[%_]/g, "");
    }

    if (productionName) {
      conditions.push(like(licences.projectName, `%${sanitise(productionName)}%`));
    }
    if (companyName) {
      conditions.push(like(licences.productionCompany, `%${sanitise(companyName)}%`));
    }
    if (licenceType) {
      conditions.push(eq(licences.licenceType, licenceType as typeof licences.licenceType._.data));
    }

    // Role-scoped access: only show licences the user is party to
    const roleCondition = or(
      eq(licences.talentId, session.sub),
      eq(licences.licenseeId, session.sub)
    );

    const searchCondition = conditions.length > 0 ? or(...conditions) : undefined;

    const rows = await db
      .select({
        id: licences.id,
        projectName: licences.projectName,
        productionCompany: licences.productionCompany,
        status: licences.status,
        licenceType: licences.licenceType,
        validFrom: licences.validFrom,
        validTo: licences.validTo,
        proposedFee: licences.proposedFee,
        agreedFee: licences.agreedFee,
        packageName: scanPackages.name,
        talentEmail: users.email,
        createdAt: licences.createdAt,
      })
      .from(licences)
      .leftJoin(scanPackages, eq(scanPackages.id, licences.packageId))
      .leftJoin(users, eq(users.id, licences.talentId))
      .where(and(roleCondition, searchCondition))
      .orderBy(desc(licences.createdAt))
      .limit(10)
      .all();

    if (rows.length === 0) {
      return {
        success: true,
        message: "No matching licences found.",
        data: { licences: [], count: 0 },
      };
    }

    const baseUrl = (ctx.env.NEXT_PUBLIC_BASE_URL as string) ?? "https://changling.io";

    const results = rows.map((r) => ({
      id: r.id,
      projectName: r.projectName,
      productionCompany: r.productionCompany,
      packageName: r.packageName,
      talentEmail: r.talentEmail,
      status: r.status,
      licenceType: r.licenceType,
      validFrom: r.validFrom,
      validTo: r.validTo,
      fee: r.agreedFee ?? r.proposedFee,
      link: `${baseUrl}/vault/licences`,
    }));

    return {
      success: true,
      message: `Found ${results.length} matching licence${results.length === 1 ? "" : "s"}.`,
      data: { licences: results, count: results.length },
    };
  },
};

registerSkill(skill);
