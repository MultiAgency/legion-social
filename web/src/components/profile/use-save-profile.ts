"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount } from "@/components/providers/account-provider";
import { qk } from "@/lib/api/queries";
import { confirmTx } from "@/lib/near/confirm";
import { errorMessage, isSigningError } from "@/lib/near/errors";
import { buildProfileWrite, type ProfileDraft, type SaveStep } from "@/lib/social/profile-draft";

const STEP_LABEL: Record<SaveStep, string> = {
  avatar: "Uploading avatar…",
  banner: "Uploading banner…",
  saving: "Saving…",
};

/** Saves a profile draft: uploads new images, writes changed `profile/*` keys, confirms. */
export function useSaveProfile() {
  const qc = useQueryClient();
  const { accountId, requireKey } = useAccount();
  const [status, setStatus] = React.useState<string | null>(null);

  const save = React.useCallback(
    async (draft: ProfileDraft, original: ProfileDraft | null): Promise<boolean> => {
      if (!accountId || !requireKey()) return false;
      try {
        const data = await buildProfileWrite(accountId, draft, original, (s) => setStatus(STEP_LABEL[s]));
        if (Object.keys(data).length === 0) {
          toast("No changes to save");
          return true;
        }
        const { writeKv } = await import("@/lib/near/kv");
        const hash = await writeKv(accountId, data);
        setStatus("Confirming…");
        try {
          await confirmTx(hash);
        } catch (err) {
          if (!isSigningError(err, "confirm_timeout")) throw err;
        }
        await qc.invalidateQueries({ queryKey: qk.profiles });
        toast.success("Profile saved");
        return true;
      } catch (err) {
        toast.error("Couldn't save your profile", { description: errorMessage(err) });
        return false;
      } finally {
        setStatus(null);
      }
    },
    [accountId, requireKey, qc],
  );

  return { save, status };
}
