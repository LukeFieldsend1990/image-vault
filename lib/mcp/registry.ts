/**
 * In-memory MCP tool registry.
 * Tools self-register via registerMcpTool(). The catalogue is code-defined,
 * not database-backed, so adding a new tool is just a new file + import
 * (same model as lib/skills/registry.ts).
 */

import type { McpToolDefinition } from "./types";

const tools = new Map<string, McpToolDefinition>();

export function registerMcpTool(tool: McpToolDefinition): void {
  tools.set(tool.name, tool);
}

export function getMcpTool(name: string): McpToolDefinition | undefined {
  return tools.get(name);
}

export function getAllMcpTools(): McpToolDefinition[] {
  return Array.from(tools.values());
}
