# JURO Component Inventory

Status: **source inventory; existence is not full UX certification**

Evidence cutoff: **2026-09-02 UZT**

## Shared product chrome

| Family | Components | Source | Current evidence |
| --- | --- | --- | --- |
| Public chrome | `SiteHeader`, `SiteFooter`, brand lockup, locale links | `apps/website/app/components/public/SiteChrome.tsx` and adjacent modules | v116 public Chrome matrix; visible locale targets 44 × 44 |
| Public theme | `PublicThemeSwitcher` | `apps/website/app/components/public/ThemeSwitcher.tsx` | light/dark control and shared-cookie behavior covered by tests |
| Public landing | `JuroHomepage`, `JuroMotionDirector` | `apps/website/app/components/public` | RU/UZ/EN production route and reveal checks |
| Platform shell | `PlatformShell`, `WorkspaceShellLayout`, `SidebarSectionLabel`, `GlobalSearch` | `apps/platform/app/_platform` | authenticated Individual shell checked at four viewports |
| Platform theme | `ThemeSwitcher` | `apps/platform/app/_theme/ThemeSwitcher.tsx` | cookie, local state, account persistence, and regression tests |
| Authentication | `AuthPage`, `AuthForm`, `TurnstileWidget` | `apps/platform/app/_auth` | v116 auth matrix; no overlap/overflow; submit remains protected |

## Core workspace families

| Product area | Principal components | Current maturity |
| --- | --- | --- |
| Dashboard | `DashboardClient`, responsive dashboard CSS | implemented; Individual shell live-checked, other personas open |
| AI workspace | `AiLawyerClient`, `LegalAnswerView`, `AiSelect`, `VoiceMessageControls`, `MemoryPanel` | implemented; source/test evidence exists, full authenticated production flow open |
| Cases and action plans | `CasesClient`, `CaseCreateClient`, `CaseWorkspaceClient`, `ActionPlanClient` | implemented; role/data journey open |
| Consultations and calendar | `ConsultationsClient`, `CalendarClient`, lawyer consultation panels | implemented; role/data journey open |
| Documents | `DocumentReviewClient`, `DocumentComparisonClient`, `ComparisonResultClient`, history/archive components | implemented; upload/result/delete production journey open |
| Document builder | questionnaire, form controls, preview, review, version history, collaboration, library, success state | implemented under `apps/platform/app/_document-builder`; authenticated journey open |
| Marketplace and lawyers | directory, profile, handoff, request/messages, proposals, checkout | implemented; complete Client/Lawyer journey open |
| Account and team | profile settings, notifications, team, billing, checkout, logout | implemented; mutation and destructive-flow QA open |
| Help and knowledge | `HelpClient`, public/private article views, feedback | implemented with keyboard/touch rules in feature CSS |

## Staff and operational families

`apps/platform/app/_staff` contains protected consoles for audit logs, AI settings, AI quality, cost control, feature flags, jobs, support, system status, knowledge management, lawyer moderation, and legal-source operations. Their presence does not establish production authorization or journey completion. Admin and fresh-MFA browser QA remain open.

## Component states required for release

Each interactive component family should explicitly cover:

- loading or pending;
- empty;
- validation error;
- provider/network error where applicable;
- success confirmation;
- disabled and permission-denied states;
- narrow viewport and long RU/UZ content;
- keyboard focus and reduced motion.

## Current gaps

- There is no single generated component catalogue or visual playground.
- Shared primitives are partially duplicated across public and platform apps.
- Feature CSS is intentionally colocated but not yet normalized to one spacing/radius API.
- Business, Pending Lawyer, and Staff/Admin component states still need role-specific production QA with controlled accounts and test data. The Lawyer shell is verified read-only; its state-changing client collaboration, dialogs, uploads, and error states remain open.
