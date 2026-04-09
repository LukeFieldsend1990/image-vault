# Image Vault — Agent Integration Spec

> **Phase 7 (Planned): Authenticated Agent Access — expose the skill catalogue to external agents and local tooling via the existing bridge token auth model.**

---

## 1. Overview

The email triage skill system (built in Phase 6) currently operates in one mode: an inbound email is triaged by AI, the platform resolves matching skills, and the inbox UI presents them for a human to review and run. The skill handlers execute server-side with the user's session.

This spec describes extending that system so the same skills can be invoked by:

1. **A server-side agent endpoint** — a single HTTP route that accepts a skill invocation (or a natural language instruction) authenticated by a bridge PAT rather than a session cookie.
2. **A local MCP server** — a small Node script running on the user's machine that wraps the HTTP endpoint and exposes skills as proper MCP tools to a host like Claude Desktop.

Together these make the skill catalogue available to agents running anywhere — on the user's local machine, in CI, or as part of a larger automation — using the same auth model the Bridge desktop app already uses.

---

## 2. Why Not "True MCP" (Yet)

The existing skill system is MCP-**inspired**: skills are self-describing tools with typed parameter schemas and execute handlers, following the same structural pattern as MCP tool definitions. But it is not MCP-**compliant**:

| Property | Current implementation | MCP spec |
|---|---|---|
| Tool definitions | `SkillDefinition[]` in TypeScript | JSON-RPC `tools/list` response |
| Tool invocation | Deterministic resolver + HTTP POST | LLM-initiated `tool_use` block |
| Transport | Next.js API route (HTTP) | stdio or HTTP+SSE with JSON-RPC envelope |
| Server lifecycle | Stateless edge function | Persistent server process with session handshake |
| LLM role | Triage classifier only | Full agent loop — LLM decides which tools to call |

The local MCP server described in section 5 bridges this gap: it wraps the Image Vault HTTP API in a real MCP server process, making it genuinely MCP-compliant from the perspective of any MCP host (Claude Desktop, Cursor, etc.).

---

## 3. Authentication Model

### 3.1 Bridge Tokens (already built)

Bridge tokens are long-lived PATs stored in `bridge_tokens` (D1). The raw token is never persisted — only `sha256(token)`. Every request from an external agent passes the token as a Bearer header:

```
Authorization: Bearer brt_<64 hex chars>
```

Server-side, `requireBridgeToken()` in `lib/auth/requireBridgeToken.ts` hashes the incoming header and resolves the associated `userId`, `role`, and any scopes. This is identical to how the CAS Bridge desktop app authenticates.

### 3.2 Token creation (already works)

```
POST /api/bridge/tokens
Cookie: session=<jwt>         ← requires active web session
Body: { "displayName": "My Local Agent" }

Response: { "id": "<uuid>", "token": "brt_..." }   ← raw token shown once
```

Tokens are managed in **Settings → Bridge** (`/settings/bridge`). There is no programmatic token creation — the user must log in to the web app and create a token there. This is intentional: it ties agent access to an authenticated web identity.

### 3.3 Scope

For V1, bridge tokens are unscoped — they carry the full permissions of the creating user. A future version may add read-only or skill-specific scopes (see section 8).

---

## 4. Server-Side Agent Endpoint

### 4.1 Purpose

A new route `POST /api/agent/invoke` accepts a skill invocation authenticated by bridge PAT. It is functionally identical to `POST /api/inbound/emails/:id/skills` but:

- Uses `requireBridgeToken()` instead of `requireSession()`
- Does not require an `emailId` — skills can be invoked without a source email
- Accepts an optional `context` object that the skill handler may use in place of structured triage data

### 4.2 Request

```
POST /api/agent/invoke
Authorization: Bearer brt_...
Content-Type: application/json

{
  "skillId": "find-package",
  "params": {
    "package_name": "Venom 4",
    "talent_name": "Tom Hardy"
  },
  "context": {
    "source": "local_agent",
    "note": "optional free-text for audit log"
  }
}
```

### 4.3 Response

```json
{
  "success": true,
  "message": "Found 2 matching packages.",
  "data": {
    "packages": [
      {
        "id": "...",
        "name": "Tom Hardy — Full Body (Venom 4)",
        "talentName": "Tom Hardy",
        "scanType": "photogrammetry",
        "totalSize": "214.3 GB",
        "fileCount": 847,
        "hasMesh": true,
        "hasTexture": true,
        "licenceRequestLink": "https://changling.io/licences/request/..."
      }
    ],
    "count": 2
  }
}
```

### 4.4 Tool listing endpoint

```
GET /api/agent/tools
Authorization: Bearer brt_...
```

Returns the full skill catalogue in a format suitable for the Anthropic `tools[]` array and the MCP `tools/list` response:

```json
{
  "tools": [
    {
      "name": "send-signup-invite",
      "description": "Send a platform invitation to onboard a new user",
      "inputSchema": {
        "type": "object",
        "properties": {
          "email":   { "type": "string",  "description": "Email address to invite" },
          "role":    { "type": "string",  "description": "Account type", "enum": ["talent", "rep", "licensee"] },
          "message": { "type": "string",  "description": "Optional personal message" }
        },
        "required": ["email", "role"]
      }
    },
    ...
  ]
}
```

### 4.5 Execution context

When a skill runs via `/api/agent/invoke`, the `SkillContext` is built from the bridge token's resolved user rather than a session payload. The `emailId` field is `null` (or an explicit ID if the caller provides one). The `skill_executions` table already records `email_id` as nullable, so no schema change is needed.

---

## 5. Local MCP Server

### 5.1 What it is

A small Node.js script (`agent/mcp-server.js`) that:

1. Implements the MCP server protocol over stdio
2. On `tools/list`, calls `GET /api/agent/tools` and returns the result
3. On `tools/call`, calls `POST /api/agent/invoke` and returns the result
4. Reads the bridge token from an env var or a local config file

The script has no dependencies beyond the `@modelcontextprotocol/sdk` package and `node-fetch` (or native fetch in Node 18+).

### 5.2 Configuration

```bash
# ~/.image-vault-agent or .env in the script directory
IMAGE_VAULT_URL=https://changling.io
IMAGE_VAULT_TOKEN=brt_...
```

### 5.3 Claude Desktop integration

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "image-vault": {
      "command": "node",
      "args": ["/path/to/image-vault/agent/mcp-server.js"],
      "env": {
        "IMAGE_VAULT_URL": "https://changling.io",
        "IMAGE_VAULT_TOKEN": "brt_..."
      }
    }
  }
}
```

Claude Desktop then discovers the skills automatically via `tools/list` and can invoke them during a conversation turn.

### 5.4 MCP server pseudo-implementation

```typescript
// agent/mcp-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const BASE = process.env.IMAGE_VAULT_URL ?? "https://changling.io";
const TOKEN = process.env.IMAGE_VAULT_TOKEN;

if (!TOKEN) throw new Error("IMAGE_VAULT_TOKEN is required");

const headers = {
  "Authorization": `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};

const server = new McpServer({ name: "image-vault", version: "1.0.0" });

// Fetch tool definitions from the platform and register them dynamically
const { tools } = await fetch(`${BASE}/api/agent/tools`, { headers }).then(r => r.json());

for (const tool of tools) {
  server.tool(tool.name, tool.description, tool.inputSchema.properties, async (params) => {
    const result = await fetch(`${BASE}/api/agent/invoke`, {
      method: "POST",
      headers,
      body: JSON.stringify({ skillId: tool.name, params }),
    }).then(r => r.json());

    return {
      content: [{ type: "text", text: result.message }],
      isError: !result.success,
    };
  });
}

const transport = new StdioServerTransport();
await server.connect(transport);
```

### 5.5 Usage from a local script (without Claude Desktop)

For scripted use without a full MCP host, the HTTP endpoint can be called directly:

```bash
curl -X POST https://changling.io/api/agent/invoke \
  -H "Authorization: Bearer brt_..." \
  -H "Content-Type: application/json" \
  -d '{"skillId":"find-package","params":{"package_name":"Venom 4"}}'
```

---

## 6. LLM-Driven Agent Loop (Future)

The endpoints above support direct skill invocation (human or script chooses which skill to call). A further step is a full agent loop where an LLM chooses the skill based on a natural language instruction.

### 6.1 Natural language invocation endpoint

```
POST /api/agent/chat
Authorization: Bearer brt_...

{ "message": "Find scan packages related to Venom 4 and check if Tom Hardy is onboarded" }
```

**Server-side flow:**

1. Fetch `getAllSkills()` → build `tools[]` for Anthropic API
2. Call Claude with the user's message + tools
3. On `tool_use` block → call `getSkill(toolName).execute(ctx, toolInput)`
4. Return result to Claude as `tool_result` block
5. Claude synthesises a final response
6. Return `{ "response": "...", "toolsUsed": [...] }`

This is an agentic loop running entirely server-side, authenticated by the bridge token. The LLM never sees scan file contents or encryption keys — only the data that skill handlers are already permitted to return.

### 6.2 Why defer this

- `/api/agent/invoke` (direct invocation) provides immediate value with no LLM cost
- The agent loop adds latency and Anthropic API cost per request
- Needs a rate-limiting / budget-check layer before exposing to all bridge token holders

---

## 7. Database

No new tables required. The existing `skill_executions` table (migration `0031_skill_executions.sql`) already logs:

| Column | Notes |
|---|---|
| `skill_id` | Which skill was run |
| `user_id` | Resolved from bridge token |
| `email_id` | NULL when invoked via agent endpoint |
| `success` | Boolean |
| `created_at` | Unix seconds |

The admin `/admin/skills` page already shows 30-day execution counts aggregated from this table, so agent-invoked skills appear there automatically alongside inbox-invoked ones.

---

## 8. API Routes to Add

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/agent/tools` | Bridge PAT | List skills as MCP-compatible tool definitions |
| `POST` | `/api/agent/invoke` | Bridge PAT | Execute a skill by ID |
| `POST` | `/api/agent/chat` | Bridge PAT | LLM-driven natural language → skill invocation (future) |

---

## 9. Files to Add / Modify

| File | Change |
|---|---|
| `app/api/agent/tools/route.ts` | New — `GET`, returns skill catalogue as tool schema |
| `app/api/agent/invoke/route.ts` | New — `POST`, executes skill via bridge PAT |
| `app/api/agent/chat/route.ts` | New (future) — `POST`, LLM agent loop |
| `agent/mcp-server.ts` | New — local MCP server script |
| `agent/package.json` | New — minimal deps: `@modelcontextprotocol/sdk` |
| `lib/skills/toToolSchema.ts` | New utility — converts `SkillDefinition[]` to Anthropic/MCP `tools[]` |

No changes to existing skill definitions, registry, resolver, or DB schema.

---

## 10. Security Considerations

- **Bridge tokens are equivalent to a user session** — treat them as secrets. They are displayed once on creation and never again.
- **Skill handlers already enforce role-based access** — a token created by a `talent` user cannot invoke admin-only operations. No additional layer needed.
- **The `/api/agent/chat` LLM loop must never pass scan file contents or encryption keys to the LLM** — the same constraint that applies to the email triage system.
- **Rate limiting** — agent endpoints should share the same IP-based rate limiting as the auth routes. For V2, per-token rate limits stored in KV.
- **Token scoping (V2)** — add an optional `scopes` column to `bridge_tokens` (e.g. `skills:read`, `skills:execute`, `skills:*`) so tokens can be issued with least-privilege access.

---

## 11. Implementation Order

| # | Step | Effort | Depends on |
|---|---|---|---|
| 1 | `lib/skills/toToolSchema.ts` — convert skill registry to Anthropic/MCP format | Small | — |
| 2 | `GET /api/agent/tools` — exposes tool schema via bridge PAT | Small | #1 |
| 3 | `POST /api/agent/invoke` — executes skill via bridge PAT | Small | #1 |
| 4 | `agent/mcp-server.ts` — local MCP server wrapping the HTTP endpoints | Medium | #2, #3 |
| 5 | `POST /api/agent/chat` — LLM-driven natural language agent loop | Medium | #1, #2, #3 |
| 6 | Token scoping (`scopes` column + enforcement) | Medium | #3 |

Steps 1–3 are the core: they make the skill catalogue callable from any HTTP client. Step 4 adds Claude Desktop integration. Step 5 is the full agent loop.

---

## 12. Related Files

| File | Purpose |
|---|---|
| `lib/skills/registry.ts` | In-memory skill catalogue |
| `lib/skills/types.ts` | `SkillDefinition`, `SkillContext`, `SkillResult` |
| `lib/skills/definitions/` | Individual skill handlers |
| `lib/auth/requireBridgeToken.ts` | PAT validation — reused by agent endpoints |
| `app/api/inbound/emails/[id]/skills/route.ts` | Existing skill execution (inbox context) |
| `app/(vault)/admin/skills/page.tsx` | Admin catalogue + usage counts |
| `drizzle/migrations/0031_skill_executions.sql` | Execution log table |
| `CAS_BRIDGE_INTEGRATION.md` | Full bridge token + PAT auth spec |

---

_Last updated: 2026-04-09. Status: planned — not yet implemented._
