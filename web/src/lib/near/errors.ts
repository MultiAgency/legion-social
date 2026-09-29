/** Typed errors for the signing pipeline, so the UI can show the right recovery action. */

export type SigningErrorCode =
  /** The app key has no allowance left: rotate the key (new allowance). */
  | "not_enough_allowance"
  /** The app key isn't on the account (deleted, or never added): re-enable posting. */
  | "access_key_not_found"
  /** No app key in this browser for the account. */
  | "no_local_key"
  /** The account can't pay for gas. */
  | "not_enough_balance"
  /** Client-side validation against STANDARD.md failed; nothing was sent. */
  | "invalid_write"
  /** RPC/network failure. */
  | "rpc_error"
  /** The wallet rejected or the user cancelled. */
  | "wallet_rejected"
  /** A FastFS upload didn't become available in time. */
  | "upload_timeout"
  /** The indexer didn't confirm the transaction in time. */
  | "confirm_timeout"
  /** The indexer rejected some keys (invalid, rate_limited, …). */
  | "indexer_rejected";

export class SigningError extends Error {
  readonly code: SigningErrorCode;
  readonly details?: unknown;
  constructor(code: SigningErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "SigningError";
    this.code = code;
    this.details = details;
  }
}

export function isSigningError(err: unknown, code?: SigningErrorCode): err is SigningError {
  return err instanceof SigningError && (code === undefined || err.code === code);
}

/** Human-readable message for any error thrown by the write pipeline. */
export function errorMessage(err: unknown): string {
  if (err instanceof SigningError) {
    switch (err.code) {
      case "not_enough_allowance":
        return "Your posting key ran out of allowance. Rotate it in Settings to keep posting.";
      case "access_key_not_found":
        return "Your posting key isn't active on this account anymore. Enable posting again.";
      case "no_local_key":
        return "Enable posting to write from this browser.";
      case "not_enough_balance":
        return "Your account doesn't have enough NEAR to pay for gas.";
      default:
        return err.message;
    }
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
