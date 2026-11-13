# JURO public website

The public Next.js website serves Russian, Uzbek and English product pages, practical guides and published professional profiles. Account workflows run in the separate platform application. The public website does not accept private case text or document uploads.

Run application installation and local services from the repository root; see [the repository README](../../README.md) and [self-hosted operations](../../docs/self-hosted-operations.md).

## Search and sharing

- `lib/public-seo.ts` defines branded titles, canonical URLs, language alternates, preview metadata and indexing rules. Published pages opt into indexing through this helper; unmatched routes remain excluded.
- `content/search-pages.ts`, `content/seo-landings.ts` and `content/product-landings.ts` contain localized public descriptions. `app/sitemap.ts` adds published content and approved professional profiles without including drafts or private application routes.
- `lib/public-platform.ts` reads the approved catalogue over the native application's loopback listener with its canonical Host. Public photo URLs remain on the application host; only approved public photos can opt into image indexing there.
- Production canonical URLs use `https://juro.uz`. Staging has noindex metadata, a closed robots file and an empty sitemap, in addition to its operator access gate.

Regenerate checked-in brand icons and 1200 × 630 preview images after changing their copy or source artwork:

```bash
npm run assets:brand
```

The renderer uses the existing JURO mark and Manrope. Static font subsets are cached under the repository's ignored `.scratch/` directory. Font downloads occur during asset generation; production serves the checked-in images without a rendering dependency or font download.

```bash
npm run build
node --test tests/*.test.mjs
```

The search tests crawl every sitemap entry with isolated published-content fixtures, resolve alternate-language links, verify image dimensions and sizes, and check that pending profiles, preview documents and staging remain excluded.

Optional `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` environment values can publish the verification tags supplied by the corresponding webmaster account. Publishing metadata does not itself create or verify an account property, request a recrawl, or guarantee a particular search result. Search engines refresh their own indexes and choose displayed titles, snippets and icons.
