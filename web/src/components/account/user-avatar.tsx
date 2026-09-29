"use client";

import * as React from "react";
import Image from "next/image";
import { env } from "@/lib/env";
import { cn, hueFor } from "@/lib/utils";

/** Only gateway URLs go through next/image (the only configured remote host). */
export function isGatewayUrl(src: string | null | undefined): src is string {
  return !!src && src.startsWith(env.fastfsGateway + "/");
}

export function UserAvatar({
  accountId,
  src,
  size = 40,
  className,
  priority,
}: {
  accountId: string;
  src?: string | null;
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = React.useState(false);
  const ok = isGatewayUrl(src) && !failed;
  const hue = hueFor(accountId);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-muted",
        className,
      )}
      style={{ width: size, height: size }}
    >
      {ok ? (
        <Image
          src={src}
          alt=""
          width={size}
          height={size}
          sizes={`${size}px`}
          preload={priority}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          aria-hidden
          className="grid size-full place-items-center font-semibold text-white/95"
          style={{
            background: `linear-gradient(135deg, oklch(0.68 0.14 ${hue}), oklch(0.5 0.14 ${(hue + 50) % 360}))`,
            fontSize: Math.max(10, Math.round(size * 0.42)),
          }}
        >
          {accountId.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
