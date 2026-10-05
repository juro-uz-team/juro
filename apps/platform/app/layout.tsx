import {ProductAnalytics} from "./_platform/ProductAnalytics";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist_Mono, Manrope } from "next/font/google";
import "./globals.css";
import "./_components/select.css";
import "./invite/invite.css";
import "./legal/legal.css";
import "./_platform/lawyer-workspace.css";
import "./_platform/legal-answer.css";
import "./_components/motion.css";
import "./_components/brand.css";
import { DocumentBootstrap } from "./_theme/DocumentBootstrap";
import {
  INTERNAL_REQUEST_PATH_HEADER,
  isLocale,
} from "../lib/platform/routing";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["cyrillic", "latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://app.juro.uz"),
  title: { default: "JURO — AI LegalTech", template: "%s — JURO" },
  description: "JURO AI LegalTech platform.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "strict-origin-when-cross-origin",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const requestPath = requestHeaders.get(INTERNAL_REQUEST_PATH_HEADER) ?? "";
  const routeLocale = requestPath.split(/[/?#]/u).filter(Boolean)[0] ?? "";
  const initialLocale = isLocale(routeLocale) ? routeLocale : "ru";

  // The request server supplies a trusted canonical path, so localized routes
  // have the correct language in the server-rendered document. The inline
  // fallback covers direct local development and legacy ?lang= entry points.
  return (
    <html
      className={`${manrope.variable} ${geistMono.variable}`}
      lang={initialLocale}
      suppressHydrationWarning
    >
      <head>
        <link rel="icon" href="/favicon.png" />
        <link rel="shortcut icon" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body className="antialiased">
        <DocumentBootstrap />
        <ProductAnalytics/>
        {children}
      </body>
    </html>
  );
}
