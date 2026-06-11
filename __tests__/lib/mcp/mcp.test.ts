import { describe, it, expect } from "vitest";
import { getAllMcpTools, getMcpTool } from "@/lib/mcp/registry";
import { CONCEPTS, getConcept } from "@/lib/mcp/semantic-layer";
import { redactParams } from "@/lib/mcp/audit";
import "@/lib/mcp/tools";

describe("mcp tool registry", () => {
  it("registers the expected tool set", () => {
    const names = getAllMcpTools().map((t) => t.name);
    // Semantic layer
    expect(names).toContain("list_concepts");
    expect(names).toContain("explain_concept");
    // Visibility
    expect(names).toContain("get_platform_overview");
    expect(names).toContain("list_users");
    expect(names).toContain("get_security_events");
    // Corrective
    expect(names).toContain("set_user_flag");
    expect(names).toContain("revoke_mcp_token");
  });

  it("marks corrective tools as mutating and visibility tools as not", () => {
    for (const name of ["set_user_flag", "set_user_role", "set_user_suspended", "restore_package", "revoke_mcp_token"]) {
      expect(getMcpTool(name)?.mutating, name).toBe(true);
    }
    for (const name of ["get_platform_overview", "list_users", "list_licences", "list_packages", "get_ai_costs", "list_concepts"]) {
      expect(getMcpTool(name)?.mutating, name).toBe(false);
    }
  });

  it("never exposes a totp_code property from tool definitions themselves", () => {
    // totp_code is injected by the dispatcher; definitions must not declare it,
    // otherwise the dispatcher's required-field merge would duplicate it
    for (const tool of getAllMcpTools()) {
      expect(Object.keys(tool.inputSchema.properties)).not.toContain("totp_code");
    }
  });
});

describe("semantic layer", () => {
  it("resolves concepts by id and cross-references stay valid", () => {
    expect(CONCEPTS.length).toBeGreaterThan(5);
    const ids = new Set(CONCEPTS.map((c) => c.id));
    for (const concept of CONCEPTS) {
      for (const rel of concept.related) {
        expect(ids.has(rel), `${concept.id} → ${rel}`).toBe(true);
      }
    }
    expect(getConcept("security-model")?.summary).toMatch(/NOT zero-knowledge/);
    expect(getConcept("nope")).toBeUndefined();
  });
});

describe("audit redaction", () => {
  it("redacts secret-bearing keys and keeps the rest", () => {
    const out = redactParams({
      email: "a@b.com",
      totp_code: "123456",
      tokenId: "abc",
      apiSecret: "shh",
      password: "pw",
      limit: 5,
    });
    expect(out.email).toBe("a@b.com");
    expect(out.limit).toBe(5);
    expect(out.totp_code).toBe("[redacted]");
    expect(out.tokenId).toBe("[redacted]");
    expect(out.apiSecret).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
  });
});
