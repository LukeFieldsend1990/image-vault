export const runtime = "edge";

import { requireAdmin } from "@/lib/auth/requireAdmin";
import { getAllSkills } from "@/lib/skills/registry";
import "@/lib/skills/definitions";

const TYPE_BADGE: Record<string, string> = {
  string: "#2563eb",
  number: "#7c3aed",
  boolean: "#d97706",
  select: "#0891b2",
};

export default async function AdminSkillsPage() {
  await requireAdmin();

  const skills = getAllSkills();

  return (
    <div className="p-8 max-w-5xl">
      <div className="mb-6">
        <p
          className="text-[10px] uppercase tracking-widest font-semibold mb-1"
          style={{ color: "var(--color-accent)" }}
        >
          Admin
        </p>
        <h1 className="text-xl font-semibold" style={{ color: "var(--color-ink)" }}>
          Skill Catalogue
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--color-muted)" }}>
          Whitelisted MCP skills available to the email triage system.
          {" "}{skills.length} skill{skills.length !== 1 ? "s" : ""} registered.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded p-5"
            style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-2">
              <div>
                <h2 className="text-sm font-semibold" style={{ color: "var(--color-ink)" }}>
                  {skill.name}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: "var(--color-muted)" }}>
                  {skill.description}
                </p>
              </div>
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded shrink-0 ml-4"
                style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", color: "var(--color-muted)" }}
              >
                {skill.id}
              </span>
            </div>

            {/* Categories */}
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "var(--color-muted)" }}>
                Triggers:
              </span>
              {skill.categories.map((cat) => (
                <span
                  key={cat}
                  className="text-[10px] px-2 py-0.5 rounded"
                  style={{ background: "rgba(192,57,43,0.08)", color: "var(--color-accent)", border: "1px solid rgba(192,57,43,0.2)" }}
                >
                  {cat}
                </span>
              ))}
            </div>

            {/* Parameters */}
            {skill.parameters.length > 0 && (
              <div>
                <span className="text-[10px] uppercase tracking-wider font-medium block mb-1.5" style={{ color: "var(--color-muted)" }}>
                  Parameters
                </span>
                <div
                  className="rounded overflow-hidden"
                  style={{ border: "1px solid var(--color-border)" }}
                >
                  {/* Header */}
                  <div
                    className="grid text-[10px] uppercase tracking-widest font-semibold px-4 py-2"
                    style={{
                      gridTemplateColumns: "1.5fr 0.8fr 0.5fr 2fr",
                      color: "var(--color-muted)",
                      background: "var(--color-bg)",
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <span>Name</span>
                    <span>Type</span>
                    <span>Req.</span>
                    <span>Description</span>
                  </div>
                  {skill.parameters.map((param) => (
                    <div
                      key={param.name}
                      className="grid items-center px-4 py-2 border-b last:border-0 text-xs"
                      style={{
                        gridTemplateColumns: "1.5fr 0.8fr 0.5fr 2fr",
                        borderColor: "var(--color-border)",
                      }}
                    >
                      <span className="font-mono text-[11px]">{param.name}</span>
                      <div className="flex items-center gap-1">
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                          style={{
                            background: `${TYPE_BADGE[param.type] ?? "#6b7280"}14`,
                            color: TYPE_BADGE[param.type] ?? "#6b7280",
                          }}
                        >
                          {param.type}
                        </span>
                      </div>
                      <span style={{ color: param.required ? "var(--color-accent)" : "var(--color-muted)" }}>
                        {param.required ? "yes" : "no"}
                      </span>
                      <div>
                        <span style={{ color: "var(--color-muted)" }}>{param.description}</span>
                        {param.options && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {param.options.map((opt) => (
                              <span
                                key={opt}
                                className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                                style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)" }}
                              >
                                {opt}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
