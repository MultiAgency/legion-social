import type { Metadata } from "next";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/shell/page-header";
import { ErrorState } from "@/components/common/states";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The social-kv/1 standard",
  description: "How near.social data is stored on NEAR FastData KV: keys, values, limits and media.",
};

export default async function DocsPage() {
  let markdown: string | null = null;
  try {
    markdown = await api.markdown("standard.md");
  } catch {
    markdown = null;
  }
  return (
    <>
      <PageHeader back title="Docs" subtitle="social-kv/1" />
      {markdown === null ? (
        <ErrorState title="The standard is unavailable" message="We couldn't load standard.md from the API." />
      ) : (
        <article className="prose prose-neutral max-w-none px-5 py-6 dark:prose-invert prose-headings:scroll-mt-20 prose-headings:tracking-tight prose-a:text-link prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-pre:border prose-pre:bg-muted prose-pre:text-foreground prose-table:text-sm prose-th:text-left">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      )}
      <p className="border-t px-5 py-4 text-sm text-muted-foreground">
        Raw files: <a className="text-link hover:underline" href="/standard.md">standard.md</a> ·{" "}
        <a className="text-link hover:underline" href="/skill.md">skill.md</a> (for AI agents) ·{" "}
        <Link className="text-link hover:underline" href="/">
          Home
        </Link>
      </p>
    </>
  );
}
