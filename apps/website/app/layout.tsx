import { ProductAnalytics } from "./components/public/ProductAnalytics";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/manrope/wght.css";
import "./globals.css";
import { BrandLoading } from "./components/public/BrandLoading";

const themeBootstrap = `(function(){try{var c=document.cookie.match(/(?:^|; )juro_theme=(system|light|dark)(?:;|$)/);var l=localStorage.getItem("juro-theme");var r=c?c[1]:(l==="light"||l==="dark"||l==="system"?l:"light");var m=r==="dark"?"dark":"light";document.documentElement.dataset.theme=m;document.documentElement.dataset.themeMode=m;document.documentElement.style.colorScheme=m;}catch(e){document.documentElement.dataset.theme="light";document.documentElement.dataset.themeMode="light";document.documentElement.style.colorScheme="light";}})();`;

export const viewport: Viewport = {
  themeColor: "#062844",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://juro.uz"),
  title: { default: "JURO — AI-юрист и юридическая помощь в Узбекистане", template: "%s — JURO" },
  description: "Цифровая юридическая платформа: AI-помощь, документы и живые юристы в одном сервисе.",
  robots: { index: true, follow: true },
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
      { "@type": "Organization", "@id": "https://juro.uz/#organization", name: "JURO", alternateName: "JURO Uzbekistan", url: "https://juro.uz", logo: { "@type": "ImageObject", url: "https://juro.uz/brand/JURO_logo_navy.png" }, description: "JURO is a LegalTech platform for legal tasks in Uzbekistan.", areaServed: { "@type": "Country", name: "Uzbekistan" }, email: "admin@juro.uz", telephone: "+998974022292", address: { "@type": "PostalAddress", addressLocality: "Tashkent", addressCountry: "UZ" } },
      { "@type": "WebSite", "@id": "https://juro.uz/#website", url: "https://juro.uz", name: "JURO", alternateName: "JURO Uzbekistan", inLanguage: ["ru", "uz", "en"], publisher: { "@id": "https://juro.uz/#organization" } },
    ],
  }).replaceAll("<", "\\u003c");
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/brand/juro-app-icon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/brand/juro-app-icon.png" />
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
