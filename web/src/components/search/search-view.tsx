"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useAccount } from "@/components/providers/account-provider";
import { AccountRow } from "@/components/account/account-row";
import { Feed } from "@/components/feed/feed";
import { AccountList } from "@/components/profile/profile-feed";
import { HeaderTabs, PageHeader } from "@/components/shell/page-header";
import { SearchBox } from "@/components/shell/sidebar-search";
import { accountListQuery, SEARCH_ACCOUNTS_PREVIEW as ACCOUNTS_PREVIEW } from "@/lib/api/queries";

export type SearchType = "posts" | "accounts";

function searchHref(q: string, type: SearchType) {
  const params = new URLSearchParams(q ? { q } : {});
  if (type === "accounts") params.set("type", "accounts");
  return `/search?${params.toString()}`;
}

export function SearchView({ q, type }: { q: string; type: SearchType }) {
  const router = useRouter();
  return (
    <>
      <PageHeader>
        <div className="flex h-[53px] items-center gap-3 px-4">
          <SearchBox
            key={q}
            defaultValue={q}
            autoFocus={!q}
            className="flex-1"
            onSearch={(value) => {
              if (value.startsWith("#") && value.length > 1) {
                router.push(`/hashtag/${encodeURIComponent(value.slice(1).toLowerCase())}`);
              } else {
                router.push(searchHref(value, type));
              }
            }}
          />
        </div>
        {q && (
          <HeaderTabs
            replace
            tabs={[
              { href: searchHref(q, "posts"), label: "Posts", active: type === "posts" },
              { href: searchHref(q, "accounts"), label: "Accounts", active: type === "accounts" },
            ]}
          />
        )}
      </PageHeader>
      {!q ? (
        <>
          <h2 className="px-4 pb-1 pt-4 text-xl font-extrabold tracking-tight">Who to follow</h2>
          <AccountList
            spec={{ kind: "suggestions" }}
            empty={{ title: "No suggestions yet", body: "Search for accounts by name or account ID." }}
          />
        </>
      ) : type === "posts" ? (
        <>
          <AccountsPreview key={`people:${q}`} q={q} />
          <Feed
            key={`posts:${q}`}
            spec={{ kind: "search", q }}
            empty={{ title: `No posts match “${q}”`, body: "Try different words." }}
          />
        </>
      ) : (
        <AccountList
          key={`accounts:${q}`}
          spec={{ kind: "search", q }}
          empty={{
            title: `No accounts match “${q}”`,
            body: (
              <span className="inline-flex items-center gap-1">
                <Search className="size-4" /> Search matches account IDs and display names.
              </span>
            ),
          }}
        />
      )}
    </>
  );
}

/** The top matching accounts above the post results; renders nothing when none match. */
function AccountsPreview({ q }: { q: string }) {
  const { accountId } = useAccount();
  const { data } = useInfiniteQuery(accountListQuery({ kind: "search", q }, accountId, ACCOUNTS_PREVIEW));
  const people = data?.pages[0]?.items.slice(0, ACCOUNTS_PREVIEW) ?? [];
  if (people.length === 0) return null;
  return (
    <section aria-label="People" className="border-b">
      <h2 className="px-4 pb-1 pt-3 text-xl font-extrabold tracking-tight">People</h2>
      {people.map((card) => (
        <AccountRow key={card.account_id} card={card} />
      ))}
      {people.length === ACCOUNTS_PREVIEW && (
        <Link
          href={searchHref(q, "accounts")}
          className="block px-4 py-3 text-[15px] text-link transition-colors hover:bg-accent/40"
        >
          Show all
        </Link>
      )}
    </section>
  );
}
