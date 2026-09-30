/**
 * Side-effect module: migrates localStorage (see storage-version.ts) as soon as the client bundle
 * loads, before anything reads it or the wallet selector starts. Import it first.
 */
import { migrateStorage } from "./storage-version";

if (typeof window !== "undefined") migrateStorage();
