// Higgsfield AI client — image-to-video pitch vignette generation
// TODO: Confirm exact endpoint paths once HIGGSFIELD_API_KEY is provisioned.
// Documented at https://docs.higgsfield.ai

const HIGGS_BASE = "https://api.higgsfield.ai/v1";

export interface HiggsJobResult {
  jobId: string;
  status: "pending" | "processing" | "complete" | "failed";
  videoUrl?: string;
  error?: string;
}

export interface SubmitVignetteParams {
  imageUrls: string[];   // presigned read URLs for R2 preview images
  prompt: string;
  durationSeconds?: number;
  model?: string;
}

export async function submitVignetteJob(
  apiKey: string,
  params: SubmitVignetteParams
): Promise<{ jobId: string }> {
  const res = await fetch(`${HIGGS_BASE}/video/image-to-video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      images: params.imageUrls,
      prompt: params.prompt,
      duration: params.durationSeconds ?? 10,
      model: params.model ?? "kling-3.0",
      training: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Higgsfield submit failed ${res.status}: ${body}`);
  }

  const data = await res.json() as { jobId?: string; job_id?: string; id?: string };
  const jobId = data.jobId ?? data.job_id ?? data.id;
  if (!jobId) throw new Error("Higgsfield response missing jobId");
  return { jobId };
}

export async function pollVignetteJob(
  apiKey: string,
  jobId: string
): Promise<HiggsJobResult> {
  const res = await fetch(`${HIGGS_BASE}/video/${jobId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Higgsfield poll failed ${res.status}`);
  }

  const data = await res.json() as {
    id?: string;
    status?: string;
    video_url?: string;
    videoUrl?: string;
    error?: string;
    output?: { url?: string };
  };

  const status = normaliseStatus(data.status ?? "pending");
  const videoUrl = data.video_url ?? data.videoUrl ?? data.output?.url;

  return { jobId, status, videoUrl, error: data.error };
}

function normaliseStatus(raw: string): HiggsJobResult["status"] {
  const s = raw.toLowerCase();
  if (s === "complete" || s === "completed" || s === "succeeded" || s === "success") return "complete";
  if (s === "failed" || s === "error") return "failed";
  if (s === "processing" || s === "running" || s === "in_progress") return "processing";
  return "pending";
}
