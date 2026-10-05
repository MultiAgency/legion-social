"use client";

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { siteName } from "@/lib/brand";
import { membershipQuery, showsNonMemberNotice } from "@/lib/legion/membership";
import { legionFeed } from "@/lib/legion/feed";

const MINT_URL = "https://nearlegion.com/mint";

/**
 * Says why a non-member's posts don't appear: to the signed-in account itself, with how to join,
 * or to anyone viewing that account's profile.
 */
export function NonMemberNotice({ accountId }: { accountId: string }) {
  const { accountId: viewer } = useAccount();
  const { data } = useQuery(membershipQuery(accountId));
  // The Legion feed account is a feed, not a person (docs/LEGION.md §3).
  if (!showsNonMemberNotice(data) || accountId === legionFeed) return null;
  return (
    <section role="status" className="flex gap-3 border-b bg-muted/40 px-4 py-3 text-[15px] leading-snug">
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-link" aria-hidden />
      {viewer === accountId ? (
        <p>
          Only NEAR Legion members appear on {siteName}, and @{accountId} doesn&apos;t hold a Legion
          token yet, so your posts won&apos;t show here. They still appear on near.social.{" "}
          <a href={MINT_URL} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
            Mint your Initiate token
          </a>
          , and your posts show here shortly after.
        </p>
      ) : (
        <p>
          Only NEAR Legion members appear on {siteName}. @{accountId} doesn&apos;t hold a Legion token,
          so its profile and posts don&apos;t show here.
        </p>
      )}
    </section>
  );
}
