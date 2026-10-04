"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Feather } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { useComposer } from "@/components/composer/composer-provider";
import { BrandMark, Wordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { siteName } from "@/lib/brand";
import { AccountMenu } from "./account-menu";
import { navItems } from "./nav-items";
import { badgeText, useUnreadCount } from "./use-unread";

export function LeftNav() {
  const pathname = usePathname();
  const { accountId, requireKey } = useAccount();
  const composer = useComposer();
  const unread = useUnreadCount();
  const items = navItems(accountId).filter((i) => !i.requiresAccount || accountId);

  return (
    <div className="flex h-full flex-col items-center px-2 xl:items-stretch xl:px-3">
      <Link
        href="/"
        className="mb-1 mt-2 flex items-center gap-2.5 rounded-full p-2.5 transition-colors hover:bg-accent xl:self-start xl:pr-4"
        aria-label={`${siteName} home`}
      >
        <BrandMark className="size-8" />
        <Wordmark className="hidden xl:inline" />
      </Link>
      <nav aria-label="Main" className="flex flex-col items-center gap-0.5 xl:items-stretch">
        {items.map((item) => {
          const active = item.match(pathname);
          const Icon = item.icon;
          const count = item.badge ? unread : 0;
          const link = (
            <Link
              key={item.label}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-4 rounded-full p-3 text-xl transition-colors hover:bg-accent xl:self-start xl:pr-6",
                active && "font-bold",
              )}
            >
              <span className="relative">
                <Icon className="size-[26px]" strokeWidth={active ? 2.6 : 2} />
                {count > 0 && (
                  <span className="absolute -right-2 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground ring-2 ring-background">
                    {badgeText(count)}
                  </span>
                )}
              </span>
              <span className="hidden xl:inline">{item.label}</span>
            </Link>
          );
          return (
            <span key={item.label} className="xl:contents">
              <span className="xl:hidden">
                <Tooltip content={item.label} side="right">
                  {link}
                </Tooltip>
              </span>
              <span className="hidden xl:contents">{link}</span>
            </span>
          );
        })}
      </nav>
      {accountId && (
        <Button
          size="xl"
          className="mt-4 size-[52px] p-0 xl:h-[52px] xl:w-full"
          onClick={() => {
            if (requireKey()) composer.open();
          }}
          aria-label="Post"
        >
          <Feather className="size-6 xl:hidden" />
          <span className="hidden xl:inline">Post</span>
        </Button>
      )}
      <div className="mt-auto w-full pb-3 pt-4">
        <AccountMenu />
      </div>
    </div>
  );
}
