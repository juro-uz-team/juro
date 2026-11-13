import { publicMetadata } from "../lib/public-seo";
import type { Metadata } from "next";
import { CinematicLandingPage } from "./components/cinematic/CinematicLandingPage";
import { ru } from "../content/ru";

export const metadata: Metadata = publicMetadata({ locale: "ru", ...ru.meta });

export default function Home() {
  return <CinematicLandingPage language="ru" />;
}
