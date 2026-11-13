import { ProductAnalytics } from "./components/public/ProductAnalytics";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/manrope/wght.css";
import "./globals.css";
import { BrandLoading } from "./components/public/BrandLoading";
import { googleTagBootstrap, googleTagSource } from "../../../scripts/google-tag.mjs";
import { publicMetadata } from "../lib/public-seo";
import { ru } from "../content/ru";

const themeBootstrap = `(function(){try{var c=document.cookie.match(/(?:^|; )juro_theme=(system|light|dark)(?:;|$)/);var l=localStorage.getItem("juro-theme");var r=c?c[1]:(l==="light"||l==="dark"||l==="system"?l:"light");var m=r==="dark"?"dark":"light";document.documentElement.dataset.theme=m;document.documentElement.dataset.themeMode=m;document.documentElement.style.colorScheme=m;}catch(e){document.documentElement.dataset.theme="light";document.documentElement.dataset.themeMode="light";document.documentElement.style.colorScheme="light";}})();`;

export const viewport: Viewport = {
  themeColor: "#062844",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://juro.uz"),
  ...publicMetadata({ locale: "ru", title: ru.meta.title, description: ru.meta.description }),
  title: { default: ru.meta.title, template: "%s — JURO" },
  // Published pages opt in through publicMetadata; unmatched routes stay out of search.
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
  },
  category: "Legal technology",
  applicationName: "JURO",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestPath = (await headers()).get("x-juro-request-path") ?? "";
  const locale = /^\/uz(?:\/|$)/.test(requestPath) ? "uz" : /^\/en(?:\/|$)/.test(requestPath) ? "en" : "ru";
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": "https://juro.uz/#organization", name: "JURO", alternateName: "JURO Uzbekistan", url: "https://juro.uz", logo: { "@type": "ImageObject", url: "https://juro.uz/brand/juro-app-icon.png", width: 512, height: 512 }, description: "JURO is a legal technology platform for AI legal assistance, document preparation and finding legal professionals in Uzbekistan.", areaServed: { "@type": "Country", name: "Uzbekistan" }, email: "admin@juro.uz", telephone: "+998974022292", address: { "@type": "PostalAddress", addressLocality: "Tashkent", addressCountry: "UZ" } },
      { "@type": "WebSite", "@id": "https://juro.uz/#website", url: "https://juro.uz/", name: "JURO", alternateName: ["JURO Uzbekistan", "juro.uz"], inLanguage: ["ru", "uz", "en"], publisher: { "@id": "https://juro.uz/#organization" } },
    ],
  }).replaceAll("<", "\\u003c");
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: googleTagBootstrap }} />
        {/* Defer keeps React from hoisting the loader above the consent defaults. */}
        <script defer src={googleTagSource} />
        <link rel="icon" href="/favicon.ico" sizes="32x32 48x48 96x96" type="image/x-icon" />
        <link rel="icon" href="/brand/juro-icon-96.png" sizes="96x96" type="image/png" />
        <link rel="apple-touch-icon" href="/brand/juro-apple-touch-icon.png" sizes="180x180" />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
        <script dangerouslySetInnerHTML={{ __html: 'document.documentElement.setAttribute("data-juro-loading", "true");' }} />
        <BrandLoading language={locale} />
        {children}
        <ProductAnalytics />
      </body>
    </html>
  );
}
