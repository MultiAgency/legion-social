"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Feather } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { useComposer } from "@/components/composer/composer-provider";
import { cn } from "@/lib/utils";
import { navItems } from "./nav-items";
import { badgeText, useUnreadCount } from "./use-unread";

/** Bottom tab bar + floating compose button (below the `sm` breakpoint). */
export function MobileNav() {
  const pathname = usePathname();
  const { accountId, requireKey } = useAccount();
  const composer = useComposer();
  const unread = useUnreadCount();
  const items = navItems(accountId)
    .filter((i) => i.label !== "Settings")
    .filter((i) => !i.requiresAccount || accountId);

  return (
    <>
      {accountId && (
        <button
          type="button"
          aria-label="New post"
          onClick={() => {
            if (requireKey()) composer.open();
          }}
          className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] right-4 z-30 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/25 transition-transform active:scale-95 sm:hidden"
        >
          <Feather className="size-6" />
        </button>
      )}
      <nav
        aria-label="Main"
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 backdrop-blur-xl sm:hidden"
      >
        <div className="flex h-14 items-stretch justify-around">
          {items.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            const count = item.badge ? unread : 0;
            return (
              <Link
                key={item.label}
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className="flex flex-1 items-center justify-center"
              >
                <span className="relative">
                  <Icon className={cn("size-[26px]", !active && "text-foreground/80")} strokeWidth={active ? 2.6 : 2} />
                  {count > 0 && (
                    <span className="absolute -right-2 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground ring-2 ring-background">
                      {badgeText(count)}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
