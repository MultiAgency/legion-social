"use client";

// First: clean up the previous near.social app's localStorage before anything reads it.
import "@/lib/storage-boot";
import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { getQueryClient } from "@/lib/api/query-client";
import { installPlaybackCoordinator } from "@/lib/media/playback";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AccountProvider } from "./account-provider";
import { ComposerProvider } from "@/components/composer/composer-provider";

export function Providers({
  initialViewer,
  children,
}: {
  initialViewer: string | null;
  children: React.ReactNode;
}) {
  const queryClient = getQueryClient();
  // Starting one audio/video (or YouTube embed) pauses the others.
  React.useEffect(installPlaybackCoordinator, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={500}>
          <AccountProvider initialViewer={initialViewer}>
            <ComposerProvider>{children}</ComposerProvider>
          </AccountProvider>
        </TooltipProvider>
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
