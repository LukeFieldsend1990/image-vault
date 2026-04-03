import { getRequestContext } from "@cloudflare/next-on-pages";

interface SessionLike {
  sub: string;
  role: string;
  email: string;
}

interface ServiceBindingEnv {
  AI_SERVICE?: Fetcher;
  AI_CRON_SERVICE?: Fetcher;
}

type ServiceBindingName = keyof ServiceBindingEnv;

function getService(binding: ServiceBindingName) {
  const { env } = getRequestContext();
  return (env as ServiceBindingEnv)[binding];
}

async function forwardAiService(
  req: Request,
  binding: ServiceBindingName,
  path: string,
  init?: {
    method?: string;
    body?: BodyInit | null;
    contentType?: string | null;
    headers?: HeadersInit;
  }
): Promise<Response> {
  const service = getService(binding);
  if (!service) {
    return Response.json({ error: `${binding} service binding is not configured` }, { status: 500 });
  }

  const url = new URL(req.url);
  url.pathname = path;

  const headers = new Headers(init?.headers);

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

export async function callAiService(
  req: Request,
  session: SessionLike,
  path: string,
  init?: {
    method?: string;
    body?: BodyInit | null;
    contentType?: string | null;
    headers?: HeadersInit;
  }
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-ai-user-id", session.sub);
  headers.set("x-ai-user-role", session.role);
  headers.set("x-ai-user-email", session.email);

  return forwardAiService(req, "AI_SERVICE", path, {
    ...init,
    headers,
  });
}

export async function callAiCronService(
  req: Request,
  session: SessionLike,
  path: string,
  init?: {
    method?: string;
    body?: BodyInit | null;
    contentType?: string | null;
    headers?: HeadersInit;
  }
): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("x-ai-user-id", session.sub);
  headers.set("x-ai-user-role", session.role);
  headers.set("x-ai-user-email", session.email);

  return forwardAiService(req, "AI_CRON_SERVICE", path, {
    ...init,
    headers,
  });
}

export async function triggerAiService(
  req: Request,
  path: string,
  init?: {
    method?: string;
    body?: BodyInit | null;
    contentType?: string | null;
    headers?: HeadersInit;
  }
): Promise<Response> {
  return forwardAiService(req, "AI_SERVICE", path, init);
}
