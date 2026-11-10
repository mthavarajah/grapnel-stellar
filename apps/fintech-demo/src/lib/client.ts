export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
): Promise<any> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();
  const res = await fetch("/api/" + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await res.json();
  if (!res.ok)
    throw new ClientError(
      result.error?.code ?? "REQUEST_FAILED",
      result.error?.message ?? "Request failed",
      res.status,
    );
  return result.data;
}
