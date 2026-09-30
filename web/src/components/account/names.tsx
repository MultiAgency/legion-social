import Link from "next/link";
import { cn } from "@/lib/utils";
import { AccountHoverCard } from "./account-hover-card";

/** Display name (falls back to the account ID) + muted @handle, truncating gracefully. */
export function NameLine({
  accountId,
  name,
  className,
  link = true,
  handle = true,
}: {
  accountId: string;
  name: string | null | undefined;
  className?: string;
  link?: boolean;
  handle?: boolean;
}) {
  const display = name?.trim() || accountId;
  const inner = (
    <>
      <span className="truncate font-bold text-foreground">{display}</span>
      {handle && <span className="truncate text-muted-foreground">@{accountId}</span>}
    </>
  );
  return link ? (
    <AccountHoverCard accountId={accountId}>
      <Link prefetch={false}
        href={`/${accountId}`}
        className={cn("flex min-w-0 items-baseline gap-1.5 hover:[&>span:first-child]:underline", className)}
      >
        {inner}
      </Link>
    </AccountHoverCard>
  ) : (
    <span className={cn("flex min-w-0 items-baseline gap-1.5", className)}>{inner}</span>
  );
}
