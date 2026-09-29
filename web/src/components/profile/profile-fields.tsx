"use client";

import * as React from "react";
import Image from "next/image";
import { Camera, X } from "lucide-react";
import { isGatewayUrl, UserAvatar } from "@/components/account/user-avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { charCount, LIMITS, validateProfileLink } from "@/lib/social/standard";
import {
  EDITABLE_SERVICES,
  type ImageDraft,
  type ProfileDraft,
} from "@/lib/social/profile-draft";
import { SERVICE_LABELS } from "./profile-links";
import { cn } from "@/lib/utils";

function previewOf(d: ImageDraft): string | null {
  if (d.kind === "new") return d.previewUrl;
  if (d.kind === "existing") return d.url;
  return null;
}

function Preview({ src, alt, sizes }: { src: string; alt: string; sizes: string }) {
  if (isGatewayUrl(src)) {
    return <Image src={src} alt={alt} fill sizes={sizes} className="object-cover" />;
  }
  // Local blob: previews (or an API proxy URL during migration).
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" />;
}

function ImagePicker({
  label,
  onPick,
  className,
}: {
  label: string;
  onPick: (file: File) => void;
  className?: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        aria-label={label}
        onClick={() => ref.current?.click()}
        className={cn(
          "grid size-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition hover:bg-black/70",
          className,
        )}
      >
        <Camera className="size-5" />
      </button>
    </>
  );
}

export function useObjectUrls() {
  const urls = React.useRef<string[]>([]);
  React.useEffect(() => {
    const list = urls.current;
    return () => list.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  return React.useCallback((blob: Blob) => {
    const u = URL.createObjectURL(blob);
    urls.current.push(u);
    return u;
  }, []);
}

export function ProfileFields({
  accountId,
  draft,
  onChange,
  disabled,
  showLinks = true,
  compact = false,
}: {
  accountId: string;
  draft: ProfileDraft;
  onChange: (d: ProfileDraft) => void;
  disabled?: boolean;
  showLinks?: boolean;
  compact?: boolean;
}) {
  const makeUrl = useObjectUrls();
  const set = <K extends keyof ProfileDraft>(k: K, v: ProfileDraft[K]) => onChange({ ...draft, [k]: v });
  const banner = previewOf(draft.banner);
  const avatar = previewOf(draft.avatar);
  const extraServices = Object.keys(draft.links).filter(
    (s) => !(EDITABLE_SERVICES as readonly string[]).includes(s),
  );
  const services = [...EDITABLE_SERVICES, ...extraServices];

  return (
    <fieldset disabled={disabled} className="space-y-5">
      <div>
        {!compact && (
          <div className="relative aspect-[3/1] overflow-hidden rounded-xl bg-muted">
            {banner && <Preview src={banner} alt="Banner" sizes="600px" />}
            <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/20">
              <ImagePicker
                label="Change banner"
                onPick={(f) => set("banner", { kind: "new", blob: f, previewUrl: makeUrl(f) })}
              />
              {draft.banner.kind !== "none" && (
                <button
                  type="button"
                  aria-label="Remove banner"
                  onClick={() => set("banner", { kind: "none" })}
                  className="grid size-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur hover:bg-black/70"
                >
                  <X className="size-5" />
                </button>
              )}
            </div>
          </div>
        )}
        <div className={cn("relative size-24 overflow-hidden rounded-full ring-4 ring-background", !compact && "-mt-10 ml-4")}>
          {avatar ? (
            <Preview src={avatar} alt="Avatar" sizes="96px" />
          ) : (
            <UserAvatar accountId={accountId} size={96} />
          )}
          <div className="absolute inset-0 grid place-items-center bg-black/25">
            <ImagePicker
              label="Change avatar"
              onPick={(f) => set("avatar", { kind: "new", blob: f, previewUrl: makeUrl(f) })}
            />
          </div>
        </div>
        {draft.avatar.kind !== "none" && (
          <button
            type="button"
            className={cn("mt-1 text-sm text-muted-foreground hover:text-destructive", !compact && "ml-4")}
            onClick={() => set("avatar", { kind: "none" })}
          >
            Remove avatar
          </button>
        )}
      </div>

      <Field label="Name" count={charCount(draft.name)} max={LIMITS.profileName}>
        <Input
          value={draft.name}
          placeholder={accountId}
          maxLength={LIMITS.profileName * 2}
          onChange={(e) => set("name", e.target.value)}
          aria-invalid={charCount(draft.name) > LIMITS.profileName}
        />
      </Field>
      <Field label="Bio" count={charCount(draft.about)} max={LIMITS.profileAbout}>
        <Textarea
          value={draft.about}
          rows={3}
          placeholder="Tell people about yourself"
          onChange={(e) => set("about", e.target.value)}
          aria-invalid={charCount(draft.about) > LIMITS.profileAbout}
        />
      </Field>
      {!compact && (
        <Field label="Location" count={charCount(draft.location)} max={LIMITS.profileLocation}>
          <Input
            value={draft.location}
            onChange={(e) => set("location", e.target.value)}
            aria-invalid={charCount(draft.location) > LIMITS.profileLocation}
          />
        </Field>
      )}
      {showLinks && !compact && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Links</p>
          {services.map((s) => {
            const value = draft.links[s] ?? "";
            const err = validateProfileLink(value);
            return (
              <div key={s} className="grid grid-cols-[96px_1fr] items-center gap-3">
                <Label htmlFor={`link-${s}`} className="text-muted-foreground">
                  {SERVICE_LABELS[s] ?? s}
                </Label>
                <div>
                  <Input
                    id={`link-${s}`}
                    value={value}
                    placeholder={s === "website" ? "https://…" : "handle"}
                    aria-invalid={!!err}
                    onChange={(e) => set("links", { ...draft.links, [s]: e.target.value })}
                  />
                  {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function Field({
  label,
  count,
  max,
  children,
}: {
  label: string;
  count: number;
  max: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label>{label}</Label>
        {count > max * 0.8 && (
          <span className={cn("text-xs tabular-nums", count > max ? "text-destructive" : "text-muted-foreground")}>
            {count.toLocaleString()} / {max.toLocaleString()}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

/** True when the draft passes the social-kv/1 field limits. */
export function draftIsValid(d: ProfileDraft): boolean {
  return (
    charCount(d.name) <= LIMITS.profileName &&
    charCount(d.about) <= LIMITS.profileAbout &&
    charCount(d.location) <= LIMITS.profileLocation &&
    Object.values(d.links).every((v) => validateProfileLink(v) === null)
  );
}
