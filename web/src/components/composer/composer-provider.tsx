"use client";

import * as React from "react";
import type { Post } from "@/lib/api/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { UserAvatar } from "@/components/account/user-avatar";
import { NameLine } from "@/components/account/names";
import { RichText } from "@/components/post/post-text";
import { RelativeTime } from "@/components/common/timestamp";
import { Composer } from "./composer";

export interface ComposeOptions {
  replyTo?: Post | null;
  quote?: Post | null;
  edit?: Post | null;
}

interface ComposerContextValue {
  open: (opts?: ComposeOptions) => void;
  close: () => void;
}

const ComposerContext = React.createContext<ComposerContextValue | null>(null);

export function useComposer(): ComposerContextValue {
  const ctx = React.useContext(ComposerContext);
  if (!ctx) throw new Error("useComposer must be used inside <ComposerProvider>");
  return ctx;
}

export function ComposerProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{ open: boolean; opts: ComposeOptions; seq: number }>({
    open: false,
    opts: {},
    seq: 0,
  });

  const value = React.useMemo<ComposerContextValue>(
    () => ({
      open: (opts = {}) => setState((s) => ({ open: true, opts, seq: s.seq + 1 })),
      close: () => setState((s) => ({ ...s, open: false })),
    }),
    [],
  );

  const { replyTo, quote, edit } = state.opts;
  const title = edit ? "Edit post" : replyTo ? "Reply" : quote ? "Quote post" : "New post";

  return (
    <ComposerContext.Provider value={value}>
      {children}
      <Dialog open={state.open} onOpenChange={(o) => !o && value.close()}>
        <DialogContent className="top-[8%] max-w-[600px] translate-y-0 gap-0 p-0 sm:top-[10%]" aria-describedby={undefined}>
          <div className="flex h-14 items-center px-4">
            <DialogTitle className="text-base font-bold">{title}</DialogTitle>
          </div>
          <div className="px-4 pb-4">
            {replyTo && (
              <div className="relative flex gap-3 pb-3">
                <div className="flex flex-col items-center">
                  <UserAvatar accountId={replyTo.author.account_id} src={replyTo.author.avatar_url} size={40} />
                  <span className="mt-1 w-0.5 flex-1 bg-border" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-1 text-[15px]">
                    <NameLine accountId={replyTo.author.account_id} name={replyTo.author.name} link={false} />
                    <span className="text-muted-foreground">·</span>
                    <RelativeTime ms={replyTo.created_at} className="shrink-0 text-muted-foreground" />
                  </div>
                  {replyTo.text && (
                    <div className="mt-0.5 line-clamp-6 text-[15px]">
                      <RichText text={replyTo.text} />
                    </div>
                  )}
                </div>
              </div>
            )}
            <Composer
              key={state.seq}
              variant="dialog"
              autoFocus
              replyTo={replyTo}
              quote={quote}
              edit={edit}
              onDone={value.close}
            />
          </div>
        </DialogContent>
      </Dialog>
    </ComposerContext.Provider>
  );
}
