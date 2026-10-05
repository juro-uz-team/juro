"use client";

import { useServerInsertedHTML } from "next/navigation";
import { THEME_BOOTSTRAP_SCRIPT } from "./theme";

// Emit blocking bootstrap scripts into the response, never the client React
// tree: a not-found fallback can remount the root layout on the client.
export function DocumentBootstrap() {
  useServerInsertedHTML(() => (
    <>
      <script id="theme-bootstrap" dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      <script id="locale-bootstrap" dangerouslySetInnerHTML={{ __html: `(function(){var m=location.pathname.match(/^\\/(ru|uz|en)(?:\\/|$)/);var q=new URLSearchParams(location.search).get("lang");document.documentElement.lang=m?m[1]:(q==="uz"?"uz":q==="en"?"en":"ru");})();` }} />
    </>
  ));
  return null;
}
