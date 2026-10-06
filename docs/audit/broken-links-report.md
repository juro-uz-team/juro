# JURO Broken Links Report

Evidence cutoff: **2026-09-02 12:45 UZT**

Live site: `https://juro.uz` Sites v97

## Result

- Sitemap URLs fetched: **78**
- Unique discoverable apex links extracted and normalized: **120**
- `juro.uz` links: **120**
- Final responses after redirects: **120 × HTTP 200**
- Unresolved or final non-2xx links in that discoverable-link set: **0**

The live crawl fetched every sitemap URL, resolved relative links, removed fragments, retained canonical apex links, and performed bounded HTTPS reachability checks. The check validates public reachability, not authenticated product outcomes. The older v95 crawl additionally included 28 `app.juro.uz` login-boundary links and is retained in history rather than mixed into this apex-only count.

## Important outcomes outside the sitemap link set

| URL / host | Evidence | Impact | Status / action |
| --- | --- | --- | --- |
| `https://lawyer.juro.uz/ru/individual/dashboard` | The platform preserves the dedicated lawyer login boundary; a separately authenticated real Lawyer session completed 16 protected routes without login fallback, 404, overflow, visible alert, or console error | The reported cross-persona “Not Found” remains removed and the dedicated Lawyer shell is now verified read-only | `VERIFIED` for anonymous and authenticated read-only boundaries; state-changing Lawyer/client flows remain separate gates |
| `https://app.juro.uz/ru/individual/document-analysis` | Platform Worker v206 preserves the protected boundary; the current status snapshot reports document analysis operational | Canonical protected route remains deployed without a public-data claim | `VERIFIED` for the boundary and retained Individual read-only coverage; authenticated upload and completed-result flow remain separate evidence gates |
| `https://juro-legaltech.muzaffarbekmurodoff.chatgpt.site/` | v97 returns `200`, canonical to `juro.uz/ru`, and `X-Robots-Tag: noindex, nofollow, noarchive` on the localized route, `robots.txt`, and `sitemap.xml` | Duplicate provider-host copy remains reachable but is explicitly excluded from indexing | `VERIFIED`; `juro.uz` remains indexable and saved v96 is the immediate rollback |
| `https://api.juro.uz/` | DNS does not resolve | Stale docs/links would fail | `DEPRECATED`; remove current-state references unless provisioned |
| `https://staging.app.juro.uz/ru/lawyer/auth` | `302` to Cloudflare Access with `Cache-Control: no-store` | Canonical staging lawyer path remains protected before application execution | `VERIFIED` for the anonymous Access boundary; authenticated runtime QA remains open |
| `https://app.staging.juro.uz/` | DNS does not resolve; PR #80 makes the platform routing helper return no lawyer origin | The wrong spelling can no longer be selected as a platform lawyer destination | `RESOLVED IN CODE`; keep rejected and use `staging.app.juro.uz` |
| `https://lawyer.staging.juro.uz/` | DNS does not resolve; PR #80 removed it from Worker and OTP/MFA dedicated-host routing | The formerly accepted hostname is no longer treated as a reachable lawyer host | `RESOLVED IN CODE`; shared staging uses `staging.app.juro.uz/{locale}/lawyer/**` |
| `https://ftp.juro.uz/` | Only record `4435f48bc863cc0ccaddd74a21791e5d`, A `95.46.96.77`, was deleted; recursive and authoritative DNS now return NXDOMAIN | The non-operational default origin is no longer exposed through this hostname | `RESOLVED`; keep absent and recreate only the saved DNS-only A record if a legitimate dependency is proven |

## Caveats

- A final `200` on `app.juro.uz` may be the localized login page after a correct authentication redirect; it does not prove the protected feature completed.
- The crawler did not submit forms, create accounts, send OTPs, upload documents, make payments, or modify data.
- The legislation database and legal-source ingestion routes were excluded by owner instruction.
- Browser visual, keyboard, and responsive review is tracked separately; this report is about link resolution.
