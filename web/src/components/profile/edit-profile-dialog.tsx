"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import type { Profile } from "@/lib/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { draftFromProfile, type ProfileDraft } from "@/lib/social/profile-draft";
import { draftIsValid, ProfileFields } from "./profile-fields";
import { useSaveProfile } from "./use-save-profile";

export function EditProfileDialog({
  profile,
  open,
  onOpenChange,
}: {
  profile: Profile;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[600px] gap-0 p-0" aria-describedby={undefined}>
        {open && <EditProfileBody profile={profile} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditProfileBody({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const original = React.useMemo(() => draftFromProfile(profile), [profile]);
  const [draft, setDraft] = React.useState<ProfileDraft>(original);
  const { save, status } = useSaveProfile();
  const valid = draftIsValid(draft);
  return (
    <>
      <div className="sticky top-0 z-10 flex h-14 items-center justify-between gap-4 border-b bg-background/90 px-4 pr-14 backdrop-blur">
        <DialogTitle className="text-lg">Edit profile</DialogTitle>
        <Button
          size="sm"
          variant="inverted"
          disabled={!valid || !!status}
          onClick={async () => {
            if (await save(draft, original)) onDone();
          }}
        >
          {status && <Loader2 className="animate-spin" />}
          {status ?? "Save"}
        </Button>
      </div>
      <div className="p-4">
        <ProfileFields accountId={profile.account_id} draft={draft} onChange={setDraft} disabled={!!status} />
      </div>
    </>
  );
}
