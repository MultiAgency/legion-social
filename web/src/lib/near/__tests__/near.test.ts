import { describe, expect, it } from "vitest";
import { KeyPair } from "@near-js/crypto";
import { decodeSignedTransaction, encodeTransaction } from "@near-js/transactions";
import { baseDecode, baseEncode } from "@near-js/utils";
import { sha256 } from "@noble/hashes/sha2";
import { encodeFastfsSimple, mediaPath } from "../fastfs";
import { validateKvArgs } from "../kv";
import { withMemoryLock } from "../queue";
import { allowanceOf, classifyTxError, RpcError } from "../rpc";
import { buildSignedTx, bytesToBase64, jsonBytes } from "../tx";
import { describeProblems, outcomeProblems } from "../confirm";
import { SigningError } from "../errors";

function u32le(n: number) {
  return [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];
}

describe("FastFS borsh encoding", () => {
  it("encodes FastfsData::Simple with Some(content)", () => {
    const path = "media/ab.webp";
    const mime = "image/webp";
    const bytes = encodeFastfsSimple(path, mime, new Uint8Array([1, 2, 3]));
    const enc = new TextEncoder();
    const expected = [
      0, // enum variant: simple
      ...u32le(path.length),
      ...enc.encode(path),
      1, // Option::Some
      ...u32le(mime.length),
      ...enc.encode(mime),
      ...u32le(3),
      1,
      2,
      3,
    ];
    expect(Array.from(bytes)).toEqual(expected);
  });

  it("builds content-addressed paths", () => {
    expect(mediaPath({ sha256hex: "abc", ext: "webp" })).toBe("media/abc.webp");
  });
});

describe("transaction signing", () => {
  // Throwaway key, never used on any network.
  const keyPair = KeyPair.fromRandom("ed25519");
  const blockHash = sha256(new TextEncoder().encode("block"));
  const args = jsonBytes({ "post/1": { text: "hi" } });

  it("builds a FunctionCall to social with gas 1 and deposit 0", () => {
    const signed = buildSignedTx({
      signerId: "alice.near",
      keyPair,
      nonce: BigInt(42),
      blockHash,
      methodName: "__fastdata_kv",
      args,
    });
    const decoded = decodeSignedTransaction(signed.bytes);
    const tx = decoded.transaction;
    expect(tx.signerId).toBe("alice.near");
    expect(tx.receiverId).toBe("social");
    expect(tx.nonce).toBe(BigInt(42));
    expect(Array.from(tx.blockHash)).toEqual(Array.from(blockHash));
    expect(tx.actions).toHaveLength(1);
    const fc = tx.actions[0].functionCall!;
    expect(fc.methodName).toBe("__fastdata_kv");
    expect(BigInt(fc.gas)).toBe(BigInt(1));
    expect(BigInt(fc.deposit)).toBe(BigInt(0));
    expect(new TextDecoder().decode(new Uint8Array(fc.args))).toBe('{"post/1":{"text":"hi"}}');
  });

  it("computes the hash as base58(sha256(borsh(tx))) and signs that digest", () => {
    const signed = buildSignedTx({
      signerId: "alice.near",
      keyPair,
      nonce: BigInt(7),
      blockHash,
      methodName: "__fastdata_fastfs",
      args: new Uint8Array([9, 9]),
    });
    const decoded = decodeSignedTransaction(signed.bytes);
    const digest = sha256(encodeTransaction(decoded.transaction));
    expect(signed.hash).toBe(baseEncode(digest));
    expect(baseDecode(signed.hash)).toHaveLength(32);
    // Decoded borsh enums are plain objects: { ed25519Signature: { data } }.
    const sig = (decoded.signature as unknown as { ed25519Signature: { data: number[] } }).ed25519Signature.data;
    expect(sig).toHaveLength(64);
    expect(keyPair.verify(digest, new Uint8Array(sig))).toBe(true);
    expect(signed.base64).toBe(Buffer.from(signed.bytes).toString("base64"));
  });

  it("bytesToBase64 matches Node's encoder for large inputs", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(bytesToBase64(big)).toBe(Buffer.from(big).toString("base64"));
  });
});

describe("KV pre-validation", () => {
  it("accepts a valid write and returns the JSON bytes", () => {
    const data = { "post/1759140000000": { text: "hello" }, "like/bob.near/1": {} };
    expect(new TextDecoder().decode(validateKvArgs(data, "alice.near"))).toBe(JSON.stringify(data));
  });

  it("rejects more than 256 keys", () => {
    const data: Record<string, unknown> = {};
    for (let i = 0; i < 257; i++) data[`graph/follow/a${i}.near`] = {};
    expect(() => validateKvArgs(data)).toThrow(/Too many keys/);
  });

  it("rejects non-ASCII keys", () => {
    expect(() => validateKvArgs({ "profile/näme": "x" })).toThrow(/ASCII/);
  });

  it("rejects values over 256 KiB", () => {
    expect(() => validateKvArgs({ "post/1": { text: "x".repeat(300_000) } })).toThrow(/256 KiB/);
  });

  it("rejects args over 1 MiB", () => {
    const data: Record<string, unknown> = {};
    for (let i = 1; i <= 60; i++) data[`post/${i}`] = { text: "x".repeat(20_000) };
    expect(() => validateKvArgs(data)).toThrow(/1 MiB/);
  });

  it("rejects social-kv/1 violations", () => {
    expect(() => validateKvArgs({ "post/1": { text: "" } })).toThrow(SigningError);
    expect(() => validateKvArgs({ "graph/follow/alice.near": {} }, "alice.near")).toThrow(/follow yourself/);
    expect(() => validateKvArgs({ "profile/avatar": "https://x/y.png" })).toThrow(/fastfs/);
    expect(() => validateKvArgs({ "like/bob.near/1": undefined })).toThrow(/no value/);
  });
});

describe("RPC error mapping", () => {
  const err = (data: unknown) => new RpcError("x", data);
  it("classifies structured errors", () => {
    expect(
      classifyTxError(err({ data: { TxExecutionError: { InvalidTxError: { InvalidNonce: { tx_nonce: 1, ak_nonce: 5 } } } } })),
    ).toBe("invalid_nonce");
    expect(
      classifyTxError(
        err({
          cause: { name: "INVALID_TRANSACTION" },
          data: { TxExecutionError: { InvalidTxError: { InvalidAccessKeyError: { NotEnoughAllowance: {} } } } },
        }),
      ),
    ).toBe("not_enough_allowance");
    expect(
      classifyTxError(err({ data: { TxExecutionError: { InvalidTxError: { InvalidAccessKeyError: { AccessKeyNotFound: {} } } } } })),
    ).toBe("access_key_not_found");
    expect(classifyTxError(err({ data: { TxExecutionError: { InvalidTxError: "Expired" } } }))).toBe("expired");
    expect(classifyTxError(err({ cause: { name: "TIMEOUT_ERROR" } }))).toBe("timeout");
    expect(classifyTxError(err({ data: { TxExecutionError: { InvalidTxError: { NotEnoughBalance: {} } } } }))).toBe(
      "not_enough_balance",
    );
    expect(classifyTxError(err({ cause: { name: "INTERNAL_ERROR" } }))).toBe("other");
  });

  it("reads allowances", () => {
    expect(allowanceOf(null)).toBeNull();
    expect(
      allowanceOf({
        nonce: 1,
        block_hash: "",
        block_height: 1,
        permission: { FunctionCall: { allowance: "1000000000000000000000000", receiver_id: "social", method_names: [] } },
      }),
    ).toBe(BigInt("1000000000000000000000000"));
    expect(allowanceOf({ nonce: 1, block_hash: "", block_height: 1, permission: "FullAccess" })).toBeNull();
  });
});

describe("serial queue", () => {
  it("runs jobs for the same name one at a time, in order, even after failures", async () => {
    const log: string[] = [];
    const slow = withMemoryLock("q", async () => {
      log.push("a:start");
      await new Promise((r) => setTimeout(r, 20));
      log.push("a:end");
      throw new Error("boom");
    });
    const fast = withMemoryLock("q", async () => {
      log.push("b");
      return 2;
    });
    await expect(slow).rejects.toThrow("boom");
    await expect(fast).resolves.toBe(2);
    expect(log).toEqual(["a:start", "a:end", "b"]);
  });
});

describe("indexer outcome", () => {
  it("reports rejected keys but not ignored backlinks", () => {
    const problems = outcomeProblems({
      tx_hash: "h",
      indexed: true,
      actions: [
        {
          status: "ok",
          keys: [
            { key: "post/1", status: "invalid", reason: "text too long" },
            { key: "reply/bob.near/1/2", status: "ignored" },
            { key: "like/bob.near/1", status: "rate_limited" },
            { key: "like/bob.near/2", status: "ok" },
          ],
        },
      ],
    });
    expect(problems.map((p) => p.status)).toEqual(["invalid", "rate_limited"]);
    expect(describeProblems(problems)).toBe("post/1: invalid: text too long (+1 more)");
  });

  it("reports whole-action failures", () => {
    expect(
      outcomeProblems({ tx_hash: "h", indexed: true, actions: [{ status: "too_many_keys", keys: [] }] }),
    ).toEqual([{ status: "too_many_keys" }]);
  });
});

describe("keystore public key derivation", () => {
  it("derives the public key from the secret string without crypto", async () => {
    const { publicKeyFromSecret } = await import("../keystore");
    const { base58Decode, base58Encode } = await import("../base58");
    for (let i = 0; i < 20; i++) {
      const kp = KeyPair.fromRandom("ed25519");
      expect(publicKeyFromSecret(kp.toString())).toBe(kp.getPublicKey().toString());
    }
    expect(publicKeyFromSecret("secp256k1:abc")).toBeNull();
    expect(publicKeyFromSecret("ed25519:0OIl")).toBeNull();
    const bytes = new Uint8Array([0, 0, 1, 2, 255]);
    expect(Array.from(base58Decode(base58Encode(bytes)))).toEqual(Array.from(bytes));
    expect(base58Encode(bytes)).toBe(baseEncode(bytes));
  });
});
