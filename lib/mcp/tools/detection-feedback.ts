/**
 * Detection-feedback tools: the human-adjudication signal on likeness hits,
 * exposed over MCP so a Claude agent can periodically pull it and use it to
 * tune the deepfake scan model (thresholds, query weighting, reference-set
 * priorities).
 *
 * Both tools are read-only views over lib/monitor/feedback.ts — the same
 * aggregation the admin panel at /admin/monitor renders.
 */

import { registerMcpTool } from "../registry";
import {
  getDetectionFeedbackSummary,
  getDetectionFeedbackExamples,
  type FeedbackLabel,
} from "@/lib/monitor/feedback";

const LABELS = new Set<string>(["confirmed", "dismissed", "whitelisted_account"]);

registerMcpTool({
  name: "get_detection_feedback_summary",
  description:
    "Aggregated human verdicts on likeness-monitor hits, read back as a scan-model tuning signal: " +
    "outcome funnel (confirmed / dismissed / whitelisted), dismissal and whitelist reason breakdowns, " +
    "detector calibration by verdict (avg likeness confidence and AI likelihood per label — high confidence " +
    "on dismissed:not_me means the likeness matcher is over-confident, high AI likelihood on dismissed:not_ai " +
    "means the synthetic check is), and a per-talent split with precision. Detector error is identity-skewed, " +
    "so per-talent rows show what global numbers hide.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  mutating: false,
  async execute(ctx) {
    const summary = await getDetectionFeedbackSummary(ctx.db);
    const { totals } = summary;
    return {
      success: true,
      message:
        `${totals.adjudicated} adjudicated hit(s): ${totals.confirmed} confirmed, ${totals.dismissed} dismissed` +
        (totals.precision !== null ? ` (precision ${totals.precision}%)` : "") +
        `; ${totals.whitelistedAccounts} whitelisted account(s); ${totals.byStatus.new ?? 0} awaiting verdict.`,
      data: summary,
    };
  },
});

registerMcpTool({
  name: "export_detection_feedback_labels",
  description:
    "Labelled examples for tuning the deepfake scan model: one row per human-labelled hit, pairing " +
    "discovery-time detector signals (likeness confidence, AI likelihood, match signals, discovery source) " +
    "with the eventual verdict. label is confirmed | dismissed | whitelisted_account; labelDetail carries " +
    "the dismissal reason (not_me = likeness matcher wrong, not_ai = synthetic check wrong, not_misuse = " +
    "detectors right, policy call) or whitelist reason. Contains talent ids but no names or emails. " +
    "For periodic incremental pulls, pass `since` = the unix time of your last pull.",
  inputSchema: {
    type: "object",
    properties: {
      since: {
        type: "number",
        description:
          "Unix seconds; only rows whose verdict landed at/after this time. Use as an incremental-pull cursor.",
      },
      label: {
        type: "string",
        description: "Filter to one label: confirmed | dismissed | whitelisted_account",
      },
      limit: { type: "number", description: "Max rows (default 200, max 1000)" },
    },
  },
  mutating: false,
  async execute(ctx, params) {
    let label: FeedbackLabel | undefined;
    if (typeof params.label === "string" && params.label) {
      if (!LABELS.has(params.label)) {
        return {
          success: false,
          message: `Unknown label "${params.label}". Use confirmed | dismissed | whitelisted_account.`,
        };
      }
      label = params.label as FeedbackLabel;
    }

    const since =
      typeof params.since === "number" && Number.isFinite(params.since)
        ? Math.max(0, Math.floor(params.since))
        : undefined;

    const requested = typeof params.limit === "number" ? Math.floor(params.limit) : 200;
    const limit = Math.min(Math.max(requested, 1), 1000);

    const examples = await getDetectionFeedbackExamples(ctx.db, { limit, since, label });

    return {
      success: true,
      message:
        `${examples.length} labelled example(s)` +
        (examples.length === limit ? ` (limit reached — page with \`since\` or raise \`limit\`)` : "") +
        (since !== undefined ? ` since ${new Date(since * 1000).toISOString()}` : "") +
        (label ? ` with label ${label}` : "") +
        ".",
      data: { examples },
    };
  },
});
