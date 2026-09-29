"use client";

import { ErrorState } from "@/components/common/states";

export default function MainError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState title="Something went wrong" message="This page failed to load." onRetry={retry} />;
}
