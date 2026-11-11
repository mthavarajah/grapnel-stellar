/** Consumer copy stays separate from structured diagnostic codes and recovery details. */
export function consumerErrorMessage(code: string, message: string): string {
  if (code === "WALLET_OPERATION_PENDING") return "Finish the wallet action already in progress.";
  if (["ACTION_EXPIRED", "AUTHORIZATION_EXPIRED", "QUOTE_EXPIRED"].includes(code)) return "This request expired. Please try again.";
  if (["CUSTOMER_SESSION_REQUIRED", "CUSTOMER_SESSION_EXPIRED", "INVALID_CUSTOMER_IDENTITY", "CUSTOMER_AUTH_REQUIRED"].includes(code)) return "Please sign in again.";
  if (code === "INSUFFICIENT_POSITION") return "You do not have enough in Earn to withdraw this amount.";
  if (code === "INSUFFICIENT_BALANCE") return "Your available balance is too low for this amount and fee.";
  if (["MODULE_NOT_ENABLED", "MODULE_DEPENDENCY_MISSING", "EXECUTION_UNAVAILABLE"].includes(code)) return "This action is unavailable right now.";
  if (["INTENT_MISMATCH", "INVALID_CUSTOMER_SIGNATURE"].includes(code)) return "The approval did not match your request. Please prepare it again.";
  if (/Privy|Stellar|Soroswap|Blend|provider|protocol|GATE[_ ]|[A-Z]+(?:_[A-Z0-9]+)+|issuer|contract/i.test(message)) return "This action is unavailable right now. Please try again.";
  return message;
}
export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: Record<string, unknown> = {},
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
    signal: AbortSignal.timeout(path === "session" && method === "GET" ? 15000 : 60000),
  });
  const result = await res.json();
  if (!res.ok)
    throw new ClientError(
      result.error?.code ?? "REQUEST_FAILED",
      consumerErrorMessage(result.error?.code ?? "REQUEST_FAILED", result.error?.message ?? "Request failed"),
      res.status,
      result.error?.details && typeof result.error.details === "object" && !Array.isArray(result.error.details) ? result.error.details : {},
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
