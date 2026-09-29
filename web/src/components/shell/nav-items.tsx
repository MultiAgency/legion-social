"use client";

import { Bell, Home, Search, Settings, User } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
  badge?: boolean;
  requiresAccount?: boolean;
}

export function navItems(accountId: string | null): NavItem[] {
  return [
    { href: "/", label: "Home", icon: Home, match: (p) => p === "/" },
    { href: "/search", label: "Search", icon: Search, match: (p) => p.startsWith("/search") || p.startsWith("/hashtag") },
    {
      href: "/notifications",
      label: "Notifications",
      icon: Bell,
      match: (p) => p.startsWith("/notifications"),
      badge: true,
      requiresAccount: true,
    },
    {
      href: accountId ? `/${accountId}` : "/",
      label: "Profile",
      icon: User,
      match: (p) => !!accountId && (p === `/${accountId}` || p.startsWith(`/${accountId}/`)),
      requiresAccount: true,
    },
    {
      href: "/settings",
      label: "Settings",
      icon: Settings,
      match: (p) => p.startsWith("/settings"),
      requiresAccount: true,
    },
  ];
}
