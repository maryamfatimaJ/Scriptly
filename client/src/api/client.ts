// Thin fetch wrapper shared by every api/*.ts module.
//
// - Always sends credentials so the httpOnly auth cookies are included.
// - Automatically attaches the CSRF token (fetched once, cached in
//   memory) as the x-csrf-token header on mutating requests, matching
//   server/src/middleware/csrf.middleware.ts.
// - Normalizes error responses into ApiError so callers can branch on
//   `error.code` / show `error.message` directly in the UI.

export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let cachedCsrfToken: string | null = null;

export async function getCsrfToken(): Promise<string> {
  if (cachedCsrfToken) return cachedCsrfToken;
  const res = await fetch(`${BASE_URL}/auth/csrf-token`, { credentials: "include" });
  const data = await res.json();
  cachedCsrfToken = data.csrfToken;
  return cachedCsrfToken as string;
}

// Call after login/register/logout so a stale token from a previous
// session is never reused.
export function resetCsrfToken() {
  cachedCsrfToken = null;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  isFormData?: boolean;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    if (options.isFormData) {
      body = options.body as FormData;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
  }

  if (method !== "GET") {
    headers["x-csrf-token"] = await getCsrfToken();
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body,
    credentials: "include",
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const contentType = res.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await res.json() : undefined;

  if (!res.ok) {
    const error = data?.error ?? { code: "UNKNOWN_ERROR", message: "Something went wrong." };
    throw new ApiError(res.status, error.code, error.message, error.details);
  }

  return data as T;
}
