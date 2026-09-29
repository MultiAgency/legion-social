import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <BrandMark className="size-12" />
      <h1 className="text-3xl font-extrabold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="text-muted-foreground">
        The link may be broken, or the account ID or post may not be valid.
      </p>
      <Button asChild>
        <Link href="/">Go home</Link>
      </Button>
    </main>
  );
}
