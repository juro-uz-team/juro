import { publicMetadata } from "../../../lib/public-seo";
import { searchPages } from "../../../content/search-pages";
import type { Metadata } from "next";
import { englishInvestorVideo } from "../../investor-video";
import { SiteFooter, SiteHeader } from "../../components/public/SiteChrome";
import styles from "../../[locale]/video/video.module.css";

export const metadata: Metadata = publicMetadata({ locale: "en", ...searchPages.en.video, path: "/video", image: "video" });

export default function EnglishInvestorVideoPage() {
  return (
    <div className={styles.page} lang="en">
      <SiteHeader languageHref="/ru/video" locale="en" tone="dark" />
      <main id="main-content">
        <section className={styles.hero}>
          <p>JURO VIDEO PRESENTATION</p>
          <h1>See how JURO turns a legal question into a clear next step</h1>
          <span>2 MIN 42 SEC · 1080P</span>
        </section>

        <section aria-label="JURO video presentation" className={styles.player}>
          <video autoPlay controls muted playsInline preload="auto">
            <source src={englishInvestorVideo.source} type="video/mp4" />
            <a href={englishInvestorVideo.source}>Open the MP4 file</a>
          </video>
          <p>The video starts automatically without sound. Turn it on in the player controls when you are ready.</p>
        </section>
      </main>
      <SiteFooter locale="en" />
    </div>
  );
}
