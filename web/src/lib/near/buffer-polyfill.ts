/**
 * Some wallet modules reference a global `Buffer` in the browser. Imported first by `wallet.ts`
 * so it runs before any wallet module is evaluated.
 */
import { Buffer } from "buffer";

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;

export {};
