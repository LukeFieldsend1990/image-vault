/**
 * Semantic-layer tools: let the MCP client orient itself in the platform's
 * concepts before reading data or making changes.
 */

import { registerMcpTool } from "../registry";
import { CONCEPTS, getConcept } from "../semantic-layer";

registerMcpTool({
  name: "list_concepts",
  description:
    "List the platform's concept map (semantic layer): one-line summaries of every domain concept — " +
    "product, security model, roles, licensing, vault, bridge, AI, audit, data model. Use explain_concept for detail.",
  inputSchema: { type: "object", properties: {} },
  mutating: false,
  async execute() {
    const concepts = CONCEPTS.map((c) => ({ id: c.id, name: c.name, summary: c.summary }));
    return { success: true, message: `${concepts.length} concept(s).`, data: { concepts } };
  },
});

registerMcpTool({
  name: "explain_concept",
  description: "Full detail for one concept from the semantic layer: how it works, where the code lives, and related concepts.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "Concept id from list_concepts" } },
    required: ["id"],
  },
  mutating: false,
  async execute(_ctx, params) {
    const id = typeof params.id === "string" ? params.id.trim() : "";
    const concept = getConcept(id);
    if (!concept) {
      return {
        success: false,
        message: `Unknown concept "${id}". Valid ids: ${CONCEPTS.map((c) => c.id).join(", ")}.`,
      };
    }
    return { success: true, message: concept.summary, data: { concept } };
  },
});
