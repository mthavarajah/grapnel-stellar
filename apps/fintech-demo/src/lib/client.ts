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
  idempotencyKey?: string,
): Promise<any> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method === "POST") headers["Idempotency-Key"] = idempotencyKey ?? crypto.randomUUID();
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

const pendingOperationKeys = new Map<string,string>();
const pendingIntent = (customerId:string,path:string,body:unknown) => `grapnel.pending:${customerId}:${path}:${JSON.stringify(body)}`;
/** Preserve the same request key through ambiguous failures and page reloads.
 * Only intent metadata and a random idempotency key are stored; never credentials or signatures. */
export function operationRequestKey(customerId:string,path:string,body:unknown):string {
 const intent=pendingIntent(customerId,path,body);
 let key=pendingOperationKeys.get(intent);
 if(!key){try{key=globalThis.sessionStorage?.getItem(intent)??undefined;}catch{/* Storage may be disabled. */}}
 if(!key){key=crypto.randomUUID();try{globalThis.sessionStorage?.setItem(intent,key);}catch{/* In-memory recovery remains available. */}}
 pendingOperationKeys.set(intent,key);return key;
}
export function clearOperationRequest(customerId:string,path:string,body:unknown):void {
 const intent=pendingIntent(customerId,path,body);pendingOperationKeys.delete(intent);
 try{globalThis.sessionStorage?.removeItem(intent);}catch{/* Storage may be disabled. */}
}
