/**
 * Builds and signs FunctionCall transactions to the `social` account with the app-held key.
 *
 * - gas is exactly 1 (function-call keys pay attached gas out of their allowance at the minimum
 *   gas price; 1 gas keeps a ~1 KB write at ≈0.001 NEAR of allowance)
 * - deposit is 0
 * - the tx hash is base58(sha256(borsh(Transaction))), computed locally
 */
import { KeyType, type KeyPair } from "@near-js/crypto";
import {
  actionCreators,
  createTransaction,
  encodeTransaction,
  Signature,
  SignedTransaction,
} from "@near-js/transactions";
import { baseEncode } from "@near-js/utils";
import { sha256 } from "@noble/hashes/sha2";
import { env } from "@/lib/env";

export const WRITE_GAS = BigInt(1);
export const WRITE_DEPOSIT = BigInt(0);

export type SocialMethod = "__fastdata_kv" | "__fastdata_fastfs";

export interface BuildTxParams {
  signerId: string;
  keyPair: KeyPair;
  nonce: bigint;
  blockHash: Uint8Array;
  methodName: SocialMethod;
  /** Raw args: JSON bytes for `__fastdata_kv`, borsh bytes for `__fastdata_fastfs`. */
  args: Uint8Array;
  receiverId?: string;
}

export interface SignedTx {
  hash: string;
  bytes: Uint8Array;
  base64: string;
}

export function buildSignedTx(p: BuildTxParams): SignedTx {
  const action = actionCreators.functionCall(p.methodName, p.args, WRITE_GAS, WRITE_DEPOSIT);
  const tx = createTransaction(
    p.signerId,
    p.keyPair.getPublicKey(),
    p.receiverId ?? env.socialAccountId,
    p.nonce,
    [action],
    p.blockHash,
  );
  const digest = sha256(encodeTransaction(tx));
  const { signature } = p.keyPair.sign(digest);
  const signed = new SignedTransaction({
    transaction: tx,
    signature: new Signature({ keyType: KeyType.ED25519, data: signature }),
  });
  const bytes = signed.encode();
  return { hash: baseEncode(digest), bytes, base64: bytesToBase64(bytes) };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}
