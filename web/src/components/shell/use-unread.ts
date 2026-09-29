"use client";

import { useQuery } from "@tanstack/react-query";
import { useAccount } from "@/components/providers/account-provider";
import { api } from "@/lib/api/client";
import { qk } from "@/lib/api/queries";
import { useNotifSeen } from "@/lib/local-store";

/** Unread notifications since the last visit to /notifications (polled every 30 s). */
export function useUnreadCount(): number {
  const { accountId } = useAccount();
  const since = useNotifSeen(accountId);
  const { data } = useQuery({
    queryKey: qk.notificationCount(accountId ?? "", since),
    queryFn: ({ signal }) => api.notificationCount(accountId!, since, signal),
    enabled: !!accountId,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
    retry: false,
  });
  return accountId ? (data?.count ?? 0) : 0;
}

export function badgeText(n: number): string {
  return n > 99 ? "99+" : String(n);
}
