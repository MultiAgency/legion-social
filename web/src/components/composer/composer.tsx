"use client";

import * as React from "react";
import Image from "next/image";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, KeyRound, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api/client";
import { profileQuery } from "@/lib/api/queries";
import type { AccountCard, Post } from "@/lib/api/types";
import { useAccount } from "@/components/providers/account-provider";
import { UserAvatar } from "@/components/account/user-avatar";
import { Button } from "@/components/ui/button";
import { LegionFeedToggle } from "@/components/legion/legion-feed-toggle";
import { writeFeed } from "@/lib/legion/feed";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/near/errors";
import type { ProcessedImage } from "@/lib/near/images";
import { preloadWallet } from "@/lib/near/wallet-loader";
import { useCreatePost, useEditPost } from "@/lib/social/hooks";
import { charCount, LIMITS, MEDIA_MIMES, type MediaMime, type MediaValue } from "@/lib/social/standard";
import { mentionQueryAt } from "@/lib/social/text";
import { cn } from "@/lib/utils";
import { QuotedPost } from "@/components/post/quoted-post";
import { isGatewayUrl } from "@/components/account/user-avatar";

interface DraftImage {
  id: string;
  previewUrl: string;
  alt: string;
  /** Already on FastFS (edit mode). */
  existing?: MediaValue;
  processing?: Promise<ProcessedImage>;
  processed?: ProcessedImage;
  error?: string;
}

export interface ComposerProps {
  replyTo?: Post | null;
  quote?: Post | null;
  edit?: Post | null;
  variant?: "inline" | "dialog" | "reply";
  autoFocus?: boolean;
  placeholder?: string;
  onDone?: () => void;
  className?: string;
  /** The feed a new post starts in: a channel account, or `social` (docs/LEGION.md §3). */
  channel?: string | null;
}

let draftSeq = 0;

function RemainingRing({ used }: { used: number }) {
  const limit = LIMITS.postText;
  const remaining = limit - used;
  const pct = Math.min(1, used / limit);
  const r = 9;
  const c = 2 * Math.PI * r;
  const near = remaining <= 500;
  const over = remaining < 0;
  if (used === 0) return null;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {near && (
        <span className={cn("text-[13px] tabular-nums", over ? "text-destructive" : "text-muted-foreground")}>
          {remaining.toLocaleString()}
        </span>
      )}
      <svg viewBox="0 0 22 22" className="size-[22px] -rotate-90" aria-hidden>
        <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2" className="stroke-border" />
        <circle
          cx="11"
          cy="11"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          strokeLinecap="round"
          className={cn(
            "transition-[stroke-dashoffset] duration-200",
            over ? "stroke-destructive" : near ? "stroke-amber-500" : "stroke-primary",
          )}
        />
      </svg>
    </div>
  );
}

function MentionList({
  items,
  activeIndex,
  onPick,
}: {
  items: AccountCard[];
  activeIndex: number;
  onPick: (accountId: string) => void;
}) {
  return (
    <ul role="listbox" aria-label="Mention suggestions" className="py-1">
      {items.map((a, i) => (
        <li key={a.account_id} role="option" aria-selected={i === activeIndex}>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(a.account_id);
            }}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left",
              i === activeIndex ? "bg-accent" : "hover:bg-accent/60",
            )}
          >
            <UserAvatar accountId={a.account_id} src={a.avatar_url} size={32} />
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold">{a.name || a.account_id}</span>
              <span className="block truncate text-sm text-muted-foreground">@{a.account_id}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useMentionSearch(query: string | null) {
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query ?? ""), 150);
    return () => clearTimeout(t);
  }, [query]);
  const { data } = useQuery({
    queryKey: ["ns", "mention", debounced],
    queryFn: ({ signal }) => api.searchAccounts(debounced, { limit: 6, signal }),
    enabled: debounced.length > 0,
    staleTime: 60_000,
  });
  return query ? (data?.items ?? []) : [];
}

export function Composer({
  replyTo = null,
  quote = null,
  edit = null,
  variant = "inline",
  autoFocus,
  placeholder,
  onDone,
  className,
  channel: initialChannel = null,
}: ComposerProps) {
  const { accountId, canWrite, requireKey, enablePosting, busy } = useAccount();
  const createPost = useCreatePost();
  const editPost = useEditPost();

  const [text, setText] = React.useState(edit?.text ?? "");
  const [images, setImages] = React.useState<DraftImage[]>(() =>
    (edit?.media ?? []).map((m) => ({
      id: `e${draftSeq++}`,
      previewUrl: m.url,
      alt: m.alt ?? "",
      existing: {
        src: m.src,
        mime: m.mime as MediaMime,
        ...(m.w ? { w: m.w } : {}),
        ...(m.h ? { h: m.h } : {}),
        ...(m.alt ? { alt: m.alt } : {}),
      },
    })),
  );
  const [phase, setPhase] = React.useState<null | { label: string }>(null);
  // A reply goes to its parent's feed; a new post to the one chosen (docs/LEGION.md §3).
  const [channel, setChannel] = React.useState<string | null>(writeFeed(replyTo ? replyTo.channel : initialChannel));
  const [expanded, setExpanded] = React.useState(variant !== "reply" || !!autoFocus);
  const [dragging, setDragging] = React.useState(false);
  const [caret, setCaret] = React.useState(0);
  const [mentionIndex, setMentionIndex] = React.useState(0);
  const [mentionDismissed, setMentionDismissed] = React.useState<number | null>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const objectUrls = React.useRef<string[]>([]);

  React.useEffect(() => {
    const urls = objectUrls.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  // Autosize.
  React.useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, variant === "dialog" ? 480 : 640)}px`;
  }, [text, variant, expanded]);

  const used = charCount(text);
  const over = used > LIMITS.postText;
  const hasContent = text.trim().length > 0 || images.length > 0 || !!quote;
  const processing = images.some((i) => i.processing && !i.processed && !i.error);
  const canSubmit = hasContent && !over && !phase && !images.some((i) => i.error);

  const mention = React.useMemo(() => {
    const m = mentionQueryAt(text, caret);
    if (!m || m.query.length === 0 || mentionDismissed === m.start) return null;
    return m;
  }, [text, caret, mentionDismissed]);
  const suggestions = useMentionSearch(mention?.query ?? null);
  const mentionIds = suggestions.map((a) => a.account_id);
  const activeMention = Math.max(0, Math.min(mentionIndex, mentionIds.length - 1));

  const addFiles = React.useCallback((files: FileList | File[]) => {
    const picked = Array.from(files).filter((f) => f.type.startsWith("image/"));
    // GIFs are uploaded as-is (to keep the animation), so the upload cap applies to them.
    // Other images are re-encoded to ≤ 1 MB, whatever their size.
    const tooBig = picked.filter((f) => f.type === "image/gif" && f.size > LIMITS.maxUploadBytes);
    if (tooBig.length > 0) {
      toast.error(tooBig.length === 1 ? `“${tooBig[0].name}” is too large` : `${tooBig.length} GIFs are too large`, {
        description: `GIFs can be up to ${LIMITS.maxUploadBytes / (1024 * 1024)} MB.`,
      });
    }
    const list = picked.filter((f) => !tooBig.includes(f));
    if (list.length === 0) return;
    setImages((prev) => {
      const room = LIMITS.postMedia - prev.length;
      if (room <= 0) {
        toast.error(`Up to ${LIMITS.postMedia} images per post.`);
        return prev;
      }
      if (list.length > room) toast(`Only the first ${room} image${room === 1 ? "" : "s"} were added.`);
      const added: DraftImage[] = list.slice(0, room).map((file) => {
        const previewUrl = URL.createObjectURL(file);
        objectUrls.current.push(previewUrl);
        const id = `n${draftSeq++}`;
        const processing = import("@/lib/near/images").then((m) => m.processImage(file));
        processing.then(
          (processed) =>
            setImages((cur) => cur.map((d) => (d.id === id ? { ...d, processed } : d))),
          (err) =>
            setImages((cur) => cur.map((d) => (d.id === id ? { ...d, error: errorMessage(err) } : d))),
        );
        return { id, previewUrl, alt: "", processing };
      });
      return [...prev, ...added];
    });
    setExpanded(true);
  }, []);

  const insertMention = (id: string) => {
    if (!mention) return;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const insert = `@${id} `;
    const next = before + insert + after.replace(/^[a-z0-9._-]*/, "");
    setText(next);
    const pos = before.length + insert.length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
        setCaret(pos);
      }
    });
  };

  const submit = async () => {
    if (!canSubmit || !accountId) return;
    if (!requireKey()) return;
    try {
      // 1. Make sure every new image is processed.
      const drafts = await Promise.all(
        images.map(async (d) => {
          if (d.existing || d.processed) return d;
          if (!d.processing) throw new Error("An image failed to load.");
          return { ...d, processed: await d.processing };
        }),
      );
      // 2. Upload to FastFS (skipped when the content-addressed file already exists).
      const { uploadMedia } = await import("@/lib/near/fastfs");
      const media: MediaValue[] = [];
      let uploadIndex = 0;
      const toUpload = drafts.filter((d) => !d.existing).length;
      for (const d of drafts) {
        const alt = d.alt.trim();
        if (d.existing) {
          const { alt: _old, ...rest } = d.existing;
          void _old;
          media.push(alt ? { ...rest, alt } : rest);
          continue;
        }
        const p = d.processed!;
        uploadIndex++;
        const label = toUpload > 1 ? `Uploading ${uploadIndex}/${toUpload}` : "Uploading image";
        setPhase({ label: `${label}…` });
        const src = await uploadMedia(accountId, p, {
          // Multi-chunk uploads (GIFs over 1 MiB) report each chunk.
          onStatus: (status, progress) => {
            if (status !== "sending" || !progress) return;
            const part = `${progress.part}/${progress.parts}`;
            setPhase({ label: toUpload > 1 ? `${label}, part ${part}…` : `${label} ${part}…` });
          },
        });
        media.push({
          src,
          mime: p.mime as MediaMime,
          w: p.w,
          h: p.h,
          ...(alt ? { alt } : {}),
        });
      }
      // 3. Send the post.
      setPhase({ label: edit ? "Saving…" : "Posting…" });
      if (edit) {
        await editPost(edit, text, media);
      } else {
        await createPost({ text, media, replyTo, quote, channel });
      }
      setText("");
      setImages([]);
      if (variant === "reply") setExpanded(false);
      onDone?.();
    } catch (err) {
      toast.error(edit ? "Couldn't save your edit" : "Couldn't post", { description: errorMessage(err) });
    } finally {
      setPhase(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && mentionIds.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % mentionIds.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + mentionIds.length) % mentionIds.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insertMention(mentionIds[activeMention]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMentionDismissed(mention.start);
        return;
      }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  if (!accountId) return null;

  const needsKey = !canWrite;
  const ph =
    placeholder ??
    (edit ? "Edit your post" : replyTo ? "Post your reply" : quote ? "Add a comment" : "What's happening?");

  return (
    <div
      className={cn("relative flex gap-3", variant === "inline" && "border-b px-4 pb-2 pt-3", className)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-1 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 text-sm font-semibold text-link">
          Drop images to attach
        </div>
      )}
      <ComposerAvatar accountId={accountId} />
      <div className="min-w-0 flex-1">
        {replyTo && variant === "dialog" && (
          <p className="mb-1 text-[15px] text-muted-foreground">
            Replying to <span className="text-link">@{replyTo.author.account_id}</span>
          </p>
        )}
        <Popover open={!!mention && mentionIds.length > 0}>
          <PopoverAnchor asChild>
            <div>
              <Textarea
                ref={textareaRef}
                value={text}
                autoFocus={autoFocus}
                rows={variant === "reply" && !expanded ? 1 : 2}
                placeholder={ph}
                aria-label={ph}
                maxLength={LIMITS.postText * 2 + 100}
                onFocus={() => {
                  setExpanded(true);
                  preloadWallet();
                }}
                onChange={(e) => {
                  setText(e.target.value);
                  setCaret(e.target.selectionStart ?? e.target.value.length);
                  setMentionIndex(0);
                }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                  if (e.clipboardData.files.length) {
                    e.preventDefault();
                    addFiles(e.clipboardData.files);
                  }
                }}
                disabled={!!phase}
                className={cn(
                  "min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-2 text-[19px] leading-snug shadow-none focus-visible:ring-0",
                  variant === "reply" && "text-[17px]",
                )}
              />
            </div>
          </PopoverAnchor>
          <PopoverContent
            className="w-72 p-1"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <MentionList items={suggestions} activeIndex={activeMention} onPick={insertMention} />
          </PopoverContent>
        </Popover>

        {images.length > 0 && (
          <div
            className={cn(
              "mt-2 grid gap-2",
              images.length === 1 ? "grid-cols-1" : images.length === 2 ? "grid-cols-2" : "grid-cols-3",
            )}
          >
            {images.map((d) => (
              <DraftThumb
                key={d.id}
                draft={d}
                single={images.length === 1}
                disabled={!!phase}
                onRemove={() => setImages((cur) => cur.filter((x) => x.id !== d.id))}
                onAlt={(alt) => setImages((cur) => cur.map((x) => (x.id === d.id ? { ...x, alt } : x)))}
              />
            ))}
          </div>
        )}

        {quote && <QuotedPost quote={quote} className="mt-2" interactive={false} />}
        {edit?.quote && <QuotedPost quote={edit.quote} className="mt-2" interactive={false} />}

        {needsKey ? (
          <div className="mt-3 flex flex-col gap-3 rounded-xl border bg-muted/40 p-3 sm:flex-row sm:items-center">
            <KeyRound className="size-5 shrink-0 text-link" />
            <p className="flex-1 text-sm text-muted-foreground">
              Approve once in your wallet to start posting. No popups after that.
            </p>
            <Button
              size="sm"
              onMouseEnter={() => preloadWallet()}
              onClick={() => void enablePosting()}
              disabled={busy === "enable"}
            >
              {busy === "enable" && <Loader2 className="animate-spin" />}
              Enable posting
            </Button>
          </div>
        ) : (
          (expanded || hasContent) && (
            <div className="mt-2 flex items-center justify-between gap-3 border-t pt-2">
              <div className="-ml-2 flex items-center">
                <input
                  ref={fileRef}
                  type="file"
                  accept={MEDIA_MIMES.join(",") + ",image/heic,image/heif"}
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  aria-label="Add images"
                  disabled={!!phase || images.length >= LIMITS.postMedia}
                  onClick={() => fileRef.current?.click()}
                  className="grid size-9 place-items-center rounded-full text-link transition-colors hover:bg-link/10 disabled:opacity-40"
                >
                  <ImagePlus className="size-5" />
                </button>
                {!edit && <LegionFeedToggle value={channel} onChange={setChannel} disabled={!!phase} reply={!!replyTo} />}
              </div>
              <div className="flex items-center gap-3">
                <RemainingRing used={used} />
                <Button
                  size="sm"
                  className="px-5"
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                  aria-busy={!!phase}
                >
                  {(phase || processing) && <Loader2 className="animate-spin" />}
                  {phase ? phase.label : edit ? "Save" : replyTo ? "Reply" : "Post"}
                </Button>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function ComposerAvatar({ accountId }: { accountId: string }) {
  const { data } = useQuery({ ...profileQuery(accountId, accountId), staleTime: 5 * 60_000 });
  return <UserAvatar accountId={accountId} src={data?.avatar_url} size={40} className="mt-1" />;
}

function DraftThumb({
  draft,
  single,
  disabled,
  onRemove,
  onAlt,
}: {
  draft: DraftImage;
  single: boolean;
  disabled: boolean;
  onRemove: () => void;
  onAlt: (alt: string) => void;
}) {
  const [altOpen, setAltOpen] = React.useState(false);
  const ready = !!draft.existing || !!draft.processed;
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-muted",
        single ? "aspect-[16/10]" : "aspect-square",
      )}
    >
      {draft.existing && isGatewayUrl(draft.previewUrl) ? (
        <Image src={draft.previewUrl} alt={draft.alt} fill sizes="300px" className="object-cover" />
      ) : (
        // Local blob preview (object URL); next/image can't optimise blob: URLs.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={draft.previewUrl} alt={draft.alt} className="absolute inset-0 size-full object-cover" />
      )}
      {!ready && !draft.error && (
        <div className="absolute inset-0 grid place-items-center bg-black/30">
          <Loader2 className="size-5 animate-spin text-white" />
        </div>
      )}
      {draft.error && (
        <div className="absolute inset-0 grid place-items-center bg-black/60 p-2 text-center text-xs font-medium text-white">
          {draft.error}
        </div>
      )}
      <button
        type="button"
        aria-label="Remove image"
        disabled={disabled}
        onClick={onRemove}
        className="absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-black/70 text-white backdrop-blur transition hover:bg-black/85"
      >
        <X className="size-4" />
      </button>
      <Popover open={altOpen} onOpenChange={setAltOpen}>
        <PopoverAnchor asChild>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setAltOpen(true)}
            className={cn(
              "absolute bottom-1.5 left-1.5 rounded-md px-2 py-0.5 text-xs font-bold text-white backdrop-blur transition",
              draft.alt ? "bg-primary/90 text-primary-foreground" : "bg-black/70 hover:bg-black/85",
            )}
          >
            {draft.alt ? "ALT ✓" : "+ALT"}
          </button>
        </PopoverAnchor>
        <PopoverContent className="w-80 p-3" align="start">
          <label className="text-sm font-semibold" htmlFor={`alt-${draft.id}`}>
            Describe this image
          </label>
          <Textarea
            id={`alt-${draft.id}`}
            className="mt-2 min-h-20 text-sm"
            value={draft.alt}
            maxLength={LIMITS.mediaAlt}
            placeholder="Alt text helps people using screen readers."
            onChange={(e) => onAlt(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={() => setAltOpen(false)}>
              Done
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
