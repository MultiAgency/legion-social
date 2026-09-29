import Link from "next/link";
import { cn } from "@/lib/utils";

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
    <Link prefetch={false}
      href={`/${accountId}`}
      className={cn("flex min-w-0 items-baseline gap-1.5 hover:[&>span:first-child]:underline", className)}
    >
      {inner}
    </Link>
  ) : (
    <span className={cn("flex min-w-0 items-baseline gap-1.5", className)}>{inner}</span>
  );
}
