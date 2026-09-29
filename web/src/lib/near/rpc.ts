/** Minimal NEAR JSON-RPC helpers (view_access_key, block, send_tx). */
import { env } from "@/lib/env";
import { SigningError } from "./errors";

export class RpcError extends Error {
  readonly data: unknown;
  constructor(message: string, data: unknown) {
    super(message);
    this.name = "RpcError";
    this.data = data;
  }
}

let rpcId = 0;

export async function rpc<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(env.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `ns-${++rpcId}`, method, params }),
      signal: signal ?? AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new SigningError("rpc_error", `Can't reach the NEAR RPC (${env.rpcUrl}).`, err);
  }
  let body: { result?: T; error?: unknown };
  try {
    body = await res.json();
  } catch {
    throw new SigningError("rpc_error", `NEAR RPC returned HTTP ${res.status}.`);
  }
  if (body.error !== undefined) {
    throw new RpcError(rpcErrorMessage(body.error), body.error);
  }
  if (!res.ok || body.result === undefined) {
    throw new SigningError("rpc_error", `NEAR RPC returned HTTP ${res.status}.`);
  }
  return body.result;
}

function rpcErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { cause?: { name?: string }; message?: string; data?: unknown };
    if (e.cause?.name) return e.cause.name;
    if (typeof e.data === "string") return e.data;
    if (e.message) return e.message;
  }
  return "RPC error";
}

/* ------------------------------------------------------------------------------------------ */

export type AccessKeyPermissionView =
  | "FullAccess"
  | {
      FunctionCall: {
        allowance: string | null;
        receiver_id: string;
        method_names: string[];
      };
    };

export interface AccessKeyView {
  nonce: number;
  permission: AccessKeyPermissionView;
  block_height: number;
  block_hash: string;
}

/** Returns the access key, or null if it doesn't exist on the account. */
export async function viewAccessKey(
  accountId: string,
  publicKey: string,
  signal?: AbortSignal,
): Promise<AccessKeyView | null> {
  try {
    const result = await rpc<AccessKeyView & { error?: string }>(
      "query",
      {
        request_type: "view_access_key",
        finality: "final",
        account_id: accountId,
        public_key: publicKey,
      },
      signal,
    );
    // Older nodes report a missing key as `result.error`.
    if (typeof result.error === "string") {
      if (/does not exist|UNKNOWN_ACCESS_KEY/i.test(result.error)) return null;
      throw new RpcError(result.error, result);
    }
    return result;
  } catch (err) {
    if (err instanceof RpcError) {
      const text = JSON.stringify(err.data ?? err.message);
      if (/UNKNOWN_ACCESS_KEY|does not exist/i.test(text)) return null;
      if (/UNKNOWN_ACCOUNT/i.test(text)) return null;
    }
    throw err;
  }
}

export interface BlockView {
  header: { hash: string; height: number; timestamp: number };
}

export function finalBlock(signal?: AbortSignal): Promise<BlockView> {
  return rpc<BlockView>("block", { finality: "final" }, signal);
}

export interface SendTxResult {
  final_execution_status?: string;
}

/** Broadcasts a signed transaction and waits until it's included in a block. */
export function sendTx(signedTxBase64: string, signal?: AbortSignal): Promise<SendTxResult> {
  return rpc<SendTxResult>(
    "send_tx",
    { signed_tx_base64: signedTxBase64, wait_until: "INCLUDED" },
    signal,
  );
}

/* ------------------------------------------------------------------------------------------ */

export type TxErrorKind =
  | "invalid_nonce"
  | "expired"
  | "not_enough_allowance"
  | "access_key_not_found"
  | "not_enough_balance"
  | "timeout"
  | "other";

/** Classifies an RPC error from `send_tx` (matches both structured and string error forms). */
export function classifyTxError(err: unknown): TxErrorKind {
  const data = err instanceof RpcError ? err.data : err;
  let text: string;
  try {
    text = typeof data === "string" ? data : JSON.stringify(data);
  } catch {
    text = String(data);
  }
  if (/InvalidNonce/.test(text)) return "invalid_nonce";
  if (/NotEnoughAllowance/.test(text)) return "not_enough_allowance";
  if (/AccessKeyNotFound|InvalidAccessKeyError|ReceiverMismatch|MethodNameMismatch/.test(text)) {
    return "access_key_not_found";
  }
  if (/NotEnoughBalance|LackBalanceForState/.test(text)) return "not_enough_balance";
  if (/Expired|InvalidChain/.test(text)) return "expired";
  if (/TIMEOUT_ERROR|Timeout/.test(text)) return "timeout";
  return "other";
}

/** Remaining allowance in yoctoNEAR (null = unlimited or not a function-call key). */
export function allowanceOf(key: AccessKeyView | null): bigint | null {
  if (!key || key.permission === "FullAccess") return null;
  const a = key.permission.FunctionCall.allowance;
  return a === null ? null : BigInt(a);
}
