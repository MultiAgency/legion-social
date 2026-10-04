"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { siteName } from "@/lib/brand";
import { membershipQuery, showsNonMemberNotice } from "@/lib/legion/membership";

const MINT_URL = "https://nearlegion.com/mint";

/** Tells a signed-in non-member why their posts don't appear, and how to join. */
export function NonMemberNotice({ accountId }: { accountId: string }) {
  const { data } = useQuery(membershipQuery(accountId));
  if (!showsNonMemberNotice(data)) return null;
  return (
    <section role="status" className="flex gap-3 border-b bg-muted/40 px-4 py-3 text-[15px] leading-snug">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-link" aria-hidden />
      <p>
        Only NEAR Legion members appear on {siteName}, and @{accountId} doesn&apos;t hold a Legion
        token yet, so your posts won&apos;t show here. They still appear on near.social.{" "}
        <a href={MINT_URL} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
          Mint your Initiate token
        </a>
        , and your posts show here shortly after.
      </p>
    </section>
  );
}
