import { publicMetadata } from "../lib/public-seo";
import type { Metadata } from "next";
import { JuroHomepage } from "./components/public/JuroHomepage";
import { ru } from "../content/ru";

export const metadata: Metadata = publicMetadata({ locale: "ru", ...ru.meta });

export default function Home() {
  return <JuroHomepage language="ru" />;
}
