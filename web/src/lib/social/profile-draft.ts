/**
 * Profile editing: a draft model shared by the edit dialog, Settings and onboarding, and the
 * save routine (process + upload images, then write flat `profile/*` keys).
 */
import type { Profile } from "@/lib/api/types";
import type { KvData } from "@/lib/near/kv";
import { keys, LIMITS, type ProfileField } from "./standard";

export type ImageDraft =
  | { kind: "none" }
  | { kind: "existing"; uri: string; url: string | null }
  | { kind: "new"; blob: Blob; previewUrl: string };

export interface ProfileDraft {
  name: string;
  about: string;
  location: string;
  links: Record<string, string>;
  avatar: ImageDraft;
  banner: ImageDraft;
}

export const EDITABLE_SERVICES = ["website", "x", "github", "telegram"] as const;

export function emptyDraft(): ProfileDraft {
  return {
    name: "",
    about: "",
    location: "",
    links: {},
    avatar: { kind: "none" },
    banner: { kind: "none" },
  };
}

export function draftFromProfile(p: Profile | null | undefined): ProfileDraft {
  if (!p) return emptyDraft();
  return {
    name: p.name ?? "",
    about: p.about ?? "",
    location: p.location ?? "",
    links: { ...p.links },
    avatar: p.avatar ? { kind: "existing", uri: p.avatar, url: p.avatar_url } : { kind: "none" },
    banner: p.banner ? { kind: "existing", uri: p.banner, url: p.banner_url } : { kind: "none" },
  };
}

function imageUri(d: ImageDraft): string | null {
  return d.kind === "existing" ? d.uri : null;
}

export type SaveStep = "avatar" | "banner" | "saving";

/**
 * Uploads new images and returns the `profile/*` KV entries that differ from `original`
 * (all non-empty fields when `original` is null).
 */
export async function buildProfileWrite(
  accountId: string,
  draft: ProfileDraft,
  original: ProfileDraft | null,
  onStep?: (step: SaveStep) => void,
): Promise<KvData> {
  const data: KvData = {};
  const setField = (field: ProfileField, next: string | null, prev: string | null) => {
    const n = next?.trim() ? next.trim() : null;
    const p = prev?.trim() ? prev.trim() : null;
    if (original === null ? n !== null : n !== p) data[keys.profile(field)] = n;
  };

  setField("name", draft.name, original?.name ?? null);
  setField("about", draft.about, original?.about ?? null);
  setField("location", draft.location, original?.location ?? null);

  for (const field of ["avatar", "banner"] as const) {
    const d = draft[field];
    let uri: string | null = imageUri(d);
    if (d.kind === "new") {
      onStep?.(field);
      const [{ processImage, AVATAR_CROP, BANNER_CROP }, { uploadMedia }] = await Promise.all([
        import("@/lib/near/images"),
        import("@/lib/near/fastfs"),
      ]);
      const processed = await processImage(d.blob, {
        crop: field === "avatar" ? AVATAR_CROP : BANNER_CROP,
      });
      uri = await uploadMedia(accountId, processed);
    }
    setField(field, uri, original ? imageUri(original[field]) : null);
  }

  const services = new Set([...Object.keys(draft.links), ...Object.keys(original?.links ?? {})]);
  for (const service of [...services].sort().slice(0, LIMITS.profileMaxLinks * 2)) {
    const n = draft.links[service]?.trim() || null;
    const p = original?.links[service]?.trim() || null;
    if (original === null ? n !== null : n !== p) data[keys.profileLink(service)] = n;
  }
  onStep?.("saving");
  return data;
}
