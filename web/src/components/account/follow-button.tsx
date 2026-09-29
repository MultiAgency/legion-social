"use client";

import * as React from "react";
import { useAccount } from "@/components/providers/account-provider";
import { Button } from "@/components/ui/button";
import { useFollowToggle } from "@/lib/social/hooks";
import { cn } from "@/lib/utils";

export function FollowButton({
  accountId,
  following,
  size = "sm",
  className,
}: {
  accountId: string;
  following: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  const { accountId: viewer } = useAccount();
  const toggle = useFollowToggle();
  const [hover, setHover] = React.useState(false);
  if (viewer === accountId) return null;
  return (
    <Button
      size={size}
      variant={following ? "outline" : "inverted"}
      aria-pressed={following}
      className={cn(
        "min-w-[92px]",
        following && "hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive",
        className,
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(accountId, following);
      }}
    >
      {following ? (hover ? "Unfollow" : "Following") : "Follow"}
    </Button>
  );
}
