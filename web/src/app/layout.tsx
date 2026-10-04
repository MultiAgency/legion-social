import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "@/components/providers/providers";
import { getViewer } from "@/lib/api/server";
import { siteUrl } from "@/lib/env";
import { siteName } from "@/lib/brand";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: siteName, template: `%s · ${siteName}` },
  description:
    `${siteName}: an open social network on NEAR. Every post, like and follow is public data on FastData KV.`,
  applicationName: siteName,
  openGraph: { siteName, type: "website" },
  twitter: { card: "summary" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0f" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="min-h-dvh font-sans">
        <Providers initialViewer={viewer}>{children}</Providers>
      </body>
    </html>
  );
}
