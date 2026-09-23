import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "@fontsource-variable/manrope/wght.css";
import "./globals.css";

const themeBootstrap = `(function(){try{var c=document.cookie.match(/(?:^|; )juro_theme=(system|light|dark)(?:;|$)/);var l=localStorage.getItem("juro-theme");var r=c?c[1]:(l==="light"||l==="dark"||l==="system"?l:"light");var m=r==="dark"?"dark":"light";document.documentElement.dataset.theme=m;document.documentElement.dataset.themeMode=m;document.documentElement.style.colorScheme=m;}catch(e){document.documentElement.dataset.theme="light";document.documentElement.dataset.themeMode="light";document.documentElement.style.colorScheme="light";}})();`;

export const viewport: Viewport = {
  themeColor: "#062844",
  colorScheme: "light",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://juro.uz"),
  title: { default: "JURO — Юрист в кармане", template: "%s — JURO" },
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
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.webmanifest" />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        {children}
      </body>
    </html>
  );
}
