"use client";

import Link from "next/link";
import { Loader2, Wallet } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { preloadWallet } from "@/lib/near/wallet-loader";
import { siteTagline } from "@/lib/brand";

export function SignInHero() {
  const { signIn, busy } = useAccount();
  return (
    <section className="relative overflow-hidden border-b px-5 py-7">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/20 blur-3xl"
      />
      <div className="relative">
        <BrandMark className="size-10" />
        <h2 className="mt-4 text-balance text-[26px] font-extrabold leading-tight tracking-tight">
          {siteTagline}
        </h2>
        <p className="mt-2 max-w-md text-[15px] leading-relaxed text-muted-foreground">
          Post, reply and follow with your NEAR account. Your data is open, so anyone can build on
          it.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            size="lg"
            onMouseEnter={() => preloadWallet()}
            onClick={() => void signIn()}
            disabled={busy === "sign-in"}
          >
            {busy === "sign-in" ? <Loader2 className="animate-spin" /> : <Wallet />}
            Sign in with NEAR
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/docs">Read the standard</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
