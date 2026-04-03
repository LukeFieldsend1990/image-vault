import { getRequestContext } from "@cloudflare/next-on-pages";

interface SessionLike {
  sub: string;
  role: string;
  email: string;
}

interface ServiceBindingEnv {
  AI_SERVICE?: Fetcher;
}

function getAiService() {
  const { env } = getRequestContext();
  return (env as ServiceBindingEnv).AI_SERVICE;
}

export async function callAiService(
  req: Request,
  session: SessionLike,
  path: string,
  init?: {
    method?: string;
    body?: BodyInit | null;
    contentType?: string | null;
  }
): Promise<Response> {
  const service = getAiService();
  if (!service) {
    return Response.json({ error: "AI service binding is not configured" }, { status: 500 });
  }

  const url = new URL(req.url);
  url.pathname = path;

  const headers = new Headers({
    "x-ai-user-id": session.sub,
    "x-ai-user-role": session.role,
    "x-ai-user-email": session.email,
  });

  if (init?.contentType) {
    headers.set("content-type", init.contentType);
  }

  return service.fetch(
    new Request(url.toString(), {
      method: init?.method ?? req.method,
      headers,
      body: init?.body ?? null,
    })
  );
}
