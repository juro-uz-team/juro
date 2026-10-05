<picture>
  <source media="(max-width: 900px)" srcset="docs/github/showcase/hero-en-mobile.svg">
  <img src="docs/github/showcase/hero-en.svg" width="100%" alt="JURO — AI-powered LegalTech workspace for questions, verified sources, documents, cases and human lawyer hand-off in Uzbekistan">
</picture>

<div align="center">
  <strong>English</strong> · <a href="README.ru.md">Русский</a> · <a href="README.uz.md">O‘zbekcha</a>
</div>

<div align="center">
  <a href="https://juro.uz"><strong>juro.uz</strong></a> ·
  <a href="https://app.juro.uz"><strong>Open platform</strong></a> ·
  <a href="#product-demo">Product demo</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#product-experience">Product experience</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#quick-start">Quick start</a>
</div>

<br>

<div align="center">
  <strong>Legal intelligence for real next steps.</strong><br>
  <sub>AI legal assistance · source-aware answers · protected document workflows · cases · human lawyer hand-off</sub>
</div>

JURO is a multilingual LegalTech workspace built for Uzbekistan with international product and engineering standards. It connects legal questions, source evidence, documents, cases and practical next steps in one protected product environment—not a disconnected AI chat.

> **Product boundary:** the visuals below are original JURO product illustrations and contain no customer data. They explain implemented and developing workflows; they are not presented as live screenshots or a substitute for individual legal advice. AI Avatar is explicitly **IN DEVELOPMENT**.

<a name="product-demo"></a>

## Product demo

<picture>
  <source media="(prefers-reduced-motion: reduce) and (max-width: 900px)" srcset="docs/github/showcase/product-demo-mobile-poster.svg">
  <source media="(prefers-reduced-motion: reduce)" srcset="docs/github/showcase/product-demo-poster.svg">
  <source media="(max-width: 900px)" srcset="docs/github/showcase/product-demo-mobile.gif">
  <img src="docs/github/showcase/product-demo.gif" width="100%" alt="Animated JURO product illustration: a legal question moves through AI analysis, a verified source, legal analysis, a next step, a document upload and optional lawyer hand-off">
</picture>

The 12.6-second loop shows the intended connected flow: **question → analysis → source → legal context → next step → document → lawyer**. The demo uses only repository-local assets; a static poster is served when reduced motion is preferred.

## What JURO can do

<picture>
  <source media="(max-width: 900px)" srcset="docs/github/showcase/capability-board-mobile.svg">
  <img src="docs/github/showcase/capability-board.svg" width="100%" alt="Eight JURO capability panels: AI legal assistant, document intelligence, document builder, case workspace, lawyer hand-off, legal sources, AI Avatar in development and legal monitoring">
</picture>

JURO brings multiple legal-work surfaces into one system. Availability still depends on account permissions and deployment state; the evidence-led status matrix below remains the source of truth for LIVE, WORKING, PARTIAL and IN DEVELOPMENT boundaries.

<a name="how-it-works"></a>

## How it works

<picture>
  <source media="(max-width: 900px)" srcset="docs/github/showcase/question-to-action-mobile.svg">
  <img src="docs/github/showcase/question-to-action.svg" width="100%" alt="JURO workflow from ask, understand and verify through document or case work, action and optional human lawyer review">
</picture>

The product is designed around progression, not chat volume: collect the right context, make source evidence visible, keep work protected and turn the result into a practical action. Human assistance remains an explicit step when the current workflow and availability permit it.

## AI that shows its sources

<picture>
  <source media="(max-width: 900px)" srcset="docs/github/showcase/source-aware-ai-mobile.svg">
  <img src="docs/github/showcase/source-aware-ai.svg" width="100%" alt="Source-aware JURO AI illustration with a question, structured answer, source identifiers and visible verification status">
</picture>

JURO’s legal-information path keeps the evidence boundary visible. Query-scoped retrieval, citation eligibility and persisted direct citations are implemented in [direct-retrieval.ts](apps/platform/lib/legal/direct-retrieval.ts) and [direct-citation-store.ts](apps/platform/lib/legal/direct-citation-store.ts). The public-source path retrieves relevant Lex.uz and Advice.uz pages; JURO does not claim an official provider API, complete legal coverage or that a source page turns AI output into individual legal advice.

## Document intelligence

<picture>
  <source media="(max-width: 900px)" srcset="docs/github/showcase/document-intelligence-mobile.svg">
  <img src="docs/github/showcase/document-intelligence.svg" width="100%" alt="JURO document intelligence illustration showing a protected contract scan, three risk areas and action-plan generation">
</picture>

Document review, comparison, versioning and action-plan surfaces exist in the protected platform. The illustration communicates the workflow, not a claim that every analysis path has completed fresh authenticated end-to-end verification; the status remains **PARTIAL** where the matrix says so.

## AI Avatar — In Development

<picture>
  <source media="(max-width: 900px)" srcset="docs/github/showcase/ai-avatar-mobile.svg">
  <img src="docs/github/showcase/ai-avatar.svg" width="100%" alt="Abstract faceless JURO AI Avatar concept with voice interaction, visual conversation and legal guidance interface tracks marked in development">
</picture>

JURO is developing a visual AI legal assistant for more natural and accessible interaction. The repository does **not** claim a production avatar, approved rigged character, live lip-sync or a completed voice path. Research, interface prototyping and asset approval remain development work.

## Human lawyer hand-off

<picture>
  <source media="(max-width: 900px)" srcset="docs/github/showcase/lawyer-handoff-mobile.svg">
  <img src="docs/github/showcase/lawyer-handoff.svg" width="100%" alt="JURO lawyer hand-off from AI assistance through protected case context to requested human review">
</picture>

The hand-off model is simple: preserve the question, sources, documents and action history so a user can request human assistance without rebuilding the case from zero. It is a controlled product workflow—not a guarantee of representation, availability or legal outcome.

## Built for production

The self-hosted architecture and operating procedures are described in [Self-hosted operations](docs/self-hosted-operations.md).

The monorepo separates public, protected and administrative surfaces while keeping credentials and data access behind server boundaries. React, Next.js and TypeScript power the frontend; Node.js, PostgreSQL, pgvector and local content-addressed files support the runtime and data layer; OpenAI configuration remains server-side; CI/CD and artifact checks support release discipline.

<a name="product-experience"></a>

## Product experience

These are repository-maintained product captures without customer data. They complement the explanatory compositions above with real product surfaces.

| Public product | Protected workspace |
|---|---|
| <img src="docs/github/screenshots/public-website.webp" alt="JURO public website" width="100%"> | <img src="docs/github/screenshots/platform-dashboard.webp" alt="JURO protected workspace without account data" width="100%"> |
| **Public website** · multilingual entry and product explanation | **Workspace** · cases, documents, actions and account-scoped navigation |

| AI legal information | Document builder |
|---|---|
| <img src="docs/github/screenshots/ai-chat.webp" alt="JURO AI legal information flow without conversation history" width="100%"> | <img src="docs/github/screenshots/document-builder.webp" alt="JURO document library and builder entry" width="100%"> |
| **AI + sources** · structured response and evidence surfaces | **Documents** · library, guided builder and generated-file paths |

| Document review | Mobile product entry |
|---|---|
| <img src="docs/github/screenshots/document-analysis.webp" alt="JURO document review and comparison entry" width="100%"> | <img src="docs/github/screenshots/mobile-experience.webp" alt="Narrow JURO public-product preview" width="100%"> |
| **Review** · analysis and comparison entry (**PARTIAL**) | **Responsive experience** · narrow public-product preview |

<a name="architecture"></a>

## Architecture and product boundaries

```mermaid
flowchart LR
  Website[Public website] --> Platform[Platform Node.js server]
  Admin[Admin Node.js server] --> Platform
  Platform --> PG[PostgreSQL and pgvector]
  Platform --> Files[Private local files]
  Jobs[Background jobs] --> PG
  Jobs --> Files
  Platform --> AI[Direct AI providers]
  Jobs --> AI
```

JURO is a monorepo with independently deployable surfaces:

- apps/website powers the public website through React, Next.js and a native Node.js server.
- apps/platform provides protected route handlers, AI evidence, document workflows, cases, authorization boundaries and generated-file flows.
- apps/admin is a separate Node.js administrative surface and remains **PARTIAL**.
- PostgreSQL, pgvector and private local files back persisted platform data and files; AI and email configuration remain server-side.
- The platform includes DOCX, PDF and ZIP generation paths; email/OTP delivery is captured locally in this private environment.

<img src="docs/github/product-overview.svg" width="100%" alt="JURO product ecosystem showing working, partial and planned components">

Solid connections denote implemented or working repository paths; dashed connections preserve PARTIAL or PLANNED boundaries. For the engineering rationale and code map, read [Product foundations](docs/github/PRODUCT_FOUNDATIONS.md).

## Trust, privacy and legal safety

<img src="docs/github/trust-layer.svg" width="100%" alt="JURO trust, privacy and legal-safety boundaries">

The repository keeps several operating boundaries inspectable: server-side credentials, backend-mediated database and file access, ownership and workspace checks, source display, and explicit limitations around AI output. No GDPR, ISO, SOC 2, data-residency or legal-outcome claim is made here.

Report a vulnerability privately through [SECURITY.md](SECURITY.md). Do not put secrets, personal data, user documents or production logs in an issue or pull request.

## Current status

| Area | Status | Notes |
|---|---|---|
| Public website | LIVE | [juro.uz](https://juro.uz) returned HTTP 200 on 2026-09-10. |
| Protected platform entry | LIVE | [app.juro.uz](https://app.juro.uz) returned HTTP 200 and redirected to the localized protected login on 2026-09-10. |
| AI legal-information flow | WORKING | Source-aware response and citation surfaces are implemented; broader legal evaluation is a separate release gate. |
| Document builder | WORKING | Persisted document workflows, private storage and generated-file paths are implemented. |
| Document analysis and comparison | PARTIAL | Review and comparison surfaces exist; fresh authenticated end-to-end evidence is not complete. |
| Cases and action plans | WORKING | Case, task and action-plan workflows are implemented. |
| Lawyer directory and consultations | PARTIAL | Controlled profiles, directory and hand-off lifecycle work is incomplete. |
| AI Avatar | IN DEVELOPMENT | The visual assistant is a declared development track; no production avatar, approved rigged character or completed live voice path is claimed. |
| Administration | PARTIAL | A separate admin server and protected administrative flows exist. |
| Production payments | PLANNED | No live payment provider is claimed in this repository. |

## Repository map

    juro/
    ├── apps/
    │   ├── website/       # juro.uz public website
    │   ├── platform/      # app.juro.uz and legal workflows
    │   └── admin/         # separate administrative server
    ├── docs/              # architecture, migrations and operations
    ├── .github/           # CI, contribution and issue templates
    ├── .env.self-hosted.example # configuration names only; no secrets
    ├── SECURITY.md
    ├── package.json
    └── README.md

## Quick start

For local development, run `npm run local` from the repository root. The platform, website, admin service and background jobs run on your PC; only PostgreSQL runs in Docker Desktop. See [local development](docs/local-development.md) for host document-tool prerequisites, verification emails and stop/start commands.

This branch runs privately on a Linux server with Node.js 22.13+, PostgreSQL 17 with pgvector, Poppler, Tesseract and ClamAV. See [Self-hosted operations](docs/self-hosted-operations.md) for installation, configuration, migrations, service startup and backup verification.

    npm run install:all
    # Configure the ignored .env.self-hosted using .env.self-hosted.example.
    docker compose --env-file .env.self-hosted up -d
    npm --prefix apps/platform run db:migrate
    npm run dev:platform

Start `npm run dev:website` and `npm run dev:admin` in separate terminals. All three services bind to loopback. The application uses local storage and direct AI provider APIs; imported legal collections remain unavailable until their integrity checks pass. Email is captured locally, and payments, automatic legal ingestion and production probes are disabled.

Never commit environment files, keys, database exports, user documents or logs.

## Quality and testing

From the repository root, with PostgreSQL and document tools available:

    npm run type-check
    npm run build
    npm test

[CI](.github/workflows/ci.yml) checks locked installs, migrations, TypeScript, production builds, native application tests and dependency licences. The rendered application tests require production builds.

## Deployment

This branch is an isolated server migration. It does not authorize production cutover, DNS changes or changes to existing Cloudflare resources. The [operations guide](docs/self-hosted-operations.md) covers private systemd services and verified backups. Historical deployment documents describe the prior architecture and are not startup instructions for this branch.

## Roadmap

| Now | Next | Later |
|---|---|---|
| Maintain source-aware information, document workflows, permissions and release evidence. | Complete authenticated verification of document analysis and lawyer hand-off. | Consider payments and wider ecosystem integrations only after their product, security and operational gates are approved. |

## Contributing and license

JURO is a product-managed repository. Focused, safe contributions are welcome; see [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) and use the supplied issue and pull-request templates. A pull request does not authorize a production deployment, DNS change or access to production data.

No license file is currently included. Reuse rights have not been granted here; contact the repository owner before using code or presentation assets.

---

Presentation-asset provenance and update rules: [docs/github/README_ASSETS.md](docs/github/README_ASSETS.md).
