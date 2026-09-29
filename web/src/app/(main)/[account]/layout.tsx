import { notFound, redirect } from "next/navigation";
import { isAccountId } from "@/lib/social/standard";

/** Validates the account segment. Any syntactically valid account ID renders. */
export default async function AccountLayout({
  params,
  children,
}: {
  params: Promise<{ account: string }>;
  children: React.ReactNode;
}) {
  const { account: raw } = await params;
  const account = decodeURIComponent(raw);
  const lower = account.toLowerCase();
  if (!isAccountId(account)) {
    if (lower !== account && isAccountId(lower)) redirect(`/${lower}`);
    notFound();
  }
  return children;
}
