import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("document review keeps a single main landmark", async () => {
  const client = await source("../app/_platform/DocumentReviewClient.tsx");
  assert.match(client, /<section className="review-result-pane" aria-label=/);
  assert.doesNotMatch(client, /<main(?:\s|>)/);
});

test("document library reveals templates in scannable batches", async () => {
  const library = await source("../app/_document-builder/_components/DocumentLibraryClient.tsx");
  assert.match(library, /const TEMPLATE_PAGE_SIZE = 12;/);
  assert.match(library, /useState\(TEMPLATE_PAGE_SIZE\)/);
  assert.match(library, /setLimit\(\(current\) => current \+ TEMPLATE_PAGE_SIZE\)/);
  assert.match(library, /aria-live="polite"/);
});

test("tablet shell uses the off-canvas navigation before content becomes cramped", async () => {
  const [shell, styles] = await Promise.all([
    source("../app/_platform/PlatformShell.tsx"),
    source("../app/_platform/platform-shell.css"),
  ]);
  assert.match(shell, /matchMedia\("\(max-width: 900px\)"\)/);
  assert.match(styles, /@media\s*\(min-width:\s*801px\)\s*and\s*\(max-width:\s*900px\)/);
  const documentNav = shell.match(/const primaryNav = \[(.*?)\] as const;/s)?.[1] ?? "";
  assert.doesNotMatch(documentNav, /\["document-builder",/);
  assert.doesNotMatch(documentNav, /\["document-review",/);
});

test("mobile AI composer ends above the fixed navigation", async () => {
  const styles = await source("../app/_platform/ai-lawyer.css");
  assert.match(styles, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.ai-dialog\s*\{[^}]*height:\s*calc\(100dvh - 70px - 68px\);[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/);
  assert.match(styles, /\.ai-workspace\s*\{[^}]*display:\s*block;[^}]*min-height:\s*0;[^}]*padding-bottom:\s*74px/);
});

test("AI composer keeps idle voice, question, and send controls on one row", async () => {
  const styles = await source("../app/_platform/ai-lawyer.css");

  assert.match(styles, /\.ai-composer-input\s*\{[^}]*grid-template-areas:\s*"voice question send"/su);
  assert.match(styles, /\.ai-composer-input\s*>\s*\.ai-voice-controls\[data-phase="idle"\][^{]*\{[^}]*grid-area:\s*voice\s*;/su);
  assert.match(styles, /\.ai-composer-input\s*>\s*textarea\s*\{[^}]*grid-area:\s*question\s*;/su);
  assert.match(styles, /\.ai-composer-input\s*>\s*button\s*\{[^}]*grid-area:\s*send\s*;/su);
  assert.match(styles, /\.ai-composer-input:has\(> \.ai-voice-controls:not\(\[data-phase="idle"\]\)\)\s*\{[^}]*"voice voice voice"\s*"question question send"/su);
});

test("AI chat keeps the answer in focus and exposes responsive history and evidence controls", async () => {
  const [client, styles] = await Promise.all([
    source("../app/_platform/AiLawyerClient.tsx"),
    source("../app/_platform/ai-lawyer.css"),
  ]);

  assert.match(client, /const \[historyCollapsed,\s*setHistoryCollapsed\]/u);
  assert.match(client, /localStorage\.setItem\("juro:ai-history"/u);
  assert.match(client, /aria-controls="ai-conversations-panel"/u);
  assert.match(client, /className="ai-mobile-context-bar"/u);
  assert.match(client, /role=\{mobileContextOpen \? "dialog" : undefined\}/u);
  assert.match(client, /hidden=\{mobileContextOpen && mobileContextTab !== "facts"\}/u);
  assert.match(client, /\{hasCaseFacts && <button[^>]+onClick=\{\(\) => openMobileContext\("facts"\)\}/u);
  assert.match(client, /hidden=\{mobileContextOpen && hasCaseFacts && mobileContextTab !== "sources"\}/u);
  assert.match(client, /latestAnswerRef\.current\?\.scrollIntoView/u);
  assert.doesNotMatch(client, /transcript\.scrollTo\(\{ top: transcript\.scrollHeight, behavior: preliminary/u);

  assert.match(styles, /\.ai-workspace\.ai-history-collapsed/u);
  assert.match(styles, /\.ai-mobile-context-bar/u);
  assert.match(styles, /\.ai-context\.is-mobile-open/u);
  assert.match(styles, /\.ai-fact[^}]*[\s\S]*?button[^}]*min-(?:width|height):\s*44px/u);
});

test("AI composer grows with its content and does not submit during IME composition", async () => {
  const client = await source("../app/_platform/AiLawyerClient.tsx");
  assert.match(client, /function resizeComposer\(/u);
  assert.match(client, /event\.nativeEvent\.isComposing/u);
  assert.match(client, /resizeComposer\(event\.currentTarget\)/u);
});

test("AI source dialog uses the shared focus lifecycle and restores its citation opener", async () => {
  const client = await source("../app/_platform/AiLawyerClient.tsx");
  assert.match(client, /activateDialogFocus\(dialog,\{initialFocus:closeRef\.current,returnFocus:returnFocus\.current/u);
  assert.match(client, /returnFocus\.current=document\.activeElement instanceof HTMLElement/u);
  assert.match(client, /ref=\{sourceDialogRef\} className="ai-source-modal" role="dialog"/u);
});

test("mobile AI context sheet uses the shared focus lifecycle and keyboard tabs", async () => {
  const client = await source("../app/_platform/AiLawyerClient.tsx");
  assert.match(client, /const dialog=mobileContextRef\.current/u);
  assert.match(client, /activateDialogFocus\(dialog,\{close:\(\)=>setMobileContextOpen\(false\)/u);
  assert.match(client, /initialFocus:dialog\.querySelector<HTMLElement>\('\[role="tab"\]\[aria-selected="true"\]'\)/u);
  assert.match(client, /\["ArrowLeft","ArrowRight","Home","End"\]\.includes\(event\.key\)/u);
  assert.match(client, /!answer\?\.facts\.length\?"sources"/u);
  assert.match(client, /aria-controls="ai-context-facts-panel"/u);
  assert.match(client, /aria-controls="ai-context-sources-panel"/u);
  assert.match(client, /role=\{mobileContextOpen \? "tabpanel" : undefined\}/u);
  assert.match(client, /ref=\{mobileContextRef\}[\s\S]*?role=\{mobileContextOpen \? "dialog" : undefined\}/u);
});

test("guest AI keeps its workspace and interactive states legible in dark mode", async () => {
  const styles = await source("../app/_guest/guest-ai.css");

  assert.match(styles, /html\[data-theme="dark"\] \.guest-ai-workspace\s*\{[^}]*background:\s*var\(--surface-raised\)/u);
  assert.match(styles, /html\[data-theme="dark"\] \.guest-ai-form textarea\s*\{[^}]*background:\s*var\(--control-background\);[^}]*color:\s*var\(--text-primary\)/u);
  assert.match(styles, /html\[data-theme="dark"\] \.guest-ai-header nav a:hover\s*\{[^}]*background:\s*var\(--surface-hover\);[^}]*color:\s*var\(--text-primary\)/u);
});

test("history presents human labels without exposing opaque entity ids", async () => {
  const history = await source("../app/_platform/HistoryClient.tsx");
  assert.doesNotMatch(history, /\{event\.entityId\}/);
  assert.match(history, /ai_chat_completed: \{ ru: "AI-ответ подготовлен", uz: "AI javobi tayyorlandi", en: "AI response prepared" \}/);
  assert.match(history, /malware_scan_clean: \{ ru: "Проверка файла завершена", uz: "Fayl tekshiruvi yakunlandi", en: "File security check completed" \}/);
  assert.match(history, /conversation: \{ ru: "Юридический диалог", uz: "Yuridik suhbat", en: "Legal conversation" \}/);
  assert.match(history, /\{ ru: "Системное действие", uz: "Tizim harakati", en: "System action" \}\[locale\]/);
});

test("dashboard changes composition before the hero controls are squeezed", async () => {
  const styles = await source("../app/_platform/dashboard.css");
  assert.match(styles, /@media\s*\(max-width:\s*600px\)/);
  assert.match(styles, /\.dashboard-command-hero\s*\{[^}]*display:\s*block;/);
  assert.match(styles, /\.dashboard-quick-grid\s*\{[^}]*grid-template-columns:\s*1fr;/);
});

test("document review mode tabs remain usable at the narrowest supported width", async () => {
  const styles = await source("../app/_platform/document-comparison.css");
  assert.match(styles, /@media\(max-width:620px\)[\s\S]*?\.review-mode-tabs button\{min-width:0;flex:1;/);
  assert.match(styles, /white-space:normal/);
  assert.match(styles, /\.review-mode-tabs button svg\{flex:none\}/);
});

test("document workspace search fields expose localized accessible names", async () => {
  const [library, documents, contacts] = await Promise.all([
    source("../app/_document-builder/_components/DocumentLibraryClient.tsx"),
    source("../app/_document-builder/documents/DocumentsClient.tsx"),
    source("../app/_document-builder/contacts/ContactsClient.tsx"),
  ]);
  assert.match(library, /placeholder=\{copy\.search\} aria-label=\{copy\.searchLabel\}/);
  assert.match(documents, /placeholder=\{copy\.search\} aria-label=\{copy\.search\}/);
  assert.match(contacts, /placeholder=\{copy\.search\} aria-label=\{copy\.search\}/);
});

test("contact editor modal owns the complete keyboard focus cycle", async () => {
  const contacts = await source("../app/_document-builder/contacts/ContactsClient.tsx");
  assert.match(contacts, /const dialogRef = useRef<HTMLFormElement>\(null\)/);
  assert.match(contacts, /if \(event\.key === "Escape"\)/);
  assert.match(contacts, /document\.activeElement === last/);
  assert.match(contacts, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(contacts, /<form ref=\{dialogRef\} className="dbt-contact-form" role="dialog" aria-modal="true"/);
});

test("document workspace dialogs trap and restore keyboard focus", async () => {
  const [focusHook, builder, documents] = await Promise.all([
    source("../app/_document-builder/_hooks/useModalFocus.ts"),
    source("../app/_document-builder/DocumentBuilderClient.tsx"),
    source("../app/_document-builder/documents/DocumentsClient.tsx"),
  ]);
  assert.match(focusHook, /if \(event\.key === "Escape"\)/);
  assert.match(focusHook, /dialogRef\.current\.contains\(document\.activeElement\)/);
  assert.match(focusHook, /event\.shiftKey && document\.activeElement === first/);
  assert.match(focusHook, /!event\.shiftKey && document\.activeElement === last/);
  assert.match(focusHook, /returnTarget\?\.focus\(\)/);
  assert.match(builder, /useModalFocus<HTMLElement>\(consultationOpen, closeConsultation\)/);
  assert.match(builder, /ref=\{consultationDialogRef\}[\s\S]*aria-describedby="consultation-description"/);
  assert.match(builder, /title: "Maslahat olish"/);
  assert.match(documents, /useModalFocus<HTMLElement>\(Boolean\(deleteDecision\), closeDeleteDecision\)/);
  assert.match(documents, /ref=\{deleteDialogRef\}[\s\S]*aria-describedby="delete-document-description"/);
  assert.match(documents, /data-dialog-initial-focus/);
});

test("standalone document icon actions expose localized accessible names", async () => {
  const [documents, copy] = await Promise.all([
    source("../app/_document-builder/documents/DocumentsClient.tsx"),
    source("../lib/platform/builder-workspace-copy.ts"),
  ]);
  assert.match(documents, /aria-label=\{copy\.close\} title=\{copy\.close\}/);
  assert.match(documents, /aria-label=\{`\$\{copy\.rename\}: \$\{file\.fileName\}`\}/);
  assert.match(documents, /aria-label=\{`\$\{copy\.restore\}: \$\{file\.fileName\}`\}/);
  assert.match(documents, /aria-label=\{`\$\{copy\.moveArchive\}: \$\{file\.fileName\}`\}/);
  assert.match(documents, /aria-label=\{`\$\{copy\.remove\}: \$\{file\.fileName\}`\}/);
  assert.match(copy, /close: "Закрыть сообщение"/);
  assert.match(copy, /close: "Xabarni yopish"/);
});

test("document workspace error dismissals and loading state follow the active locale", async () => {
  const [contacts, configuredBuilder] = await Promise.all([
    source("../app/_document-builder/contacts/ContactsClient.tsx"),
    source("../app/_document-builder/_components/ConfigurableDocumentBuilder.tsx"),
  ]);
  assert.match(contacts, /aria-label=\{copy\.close\} title=\{copy\.close\}/);
  assert.match(configuredBuilder, /aria-label=\{copy\.closeMessage\} title=\{copy\.closeMessage\}/);
  assert.match(configuredBuilder, /<p>\{copy\.loading\}<\/p>/);
  assert.match(configuredBuilder, /closeMessage: "Close message"/);
  assert.match(configuredBuilder, /loading: "Loading document builder…"/);
});

test("document rename uses the JURO dialog instead of a native prompt", async () => {
  const [documents, copy, styles] = await Promise.all([
    source("../app/_document-builder/documents/DocumentsClient.tsx"),
    source("../lib/platform/builder-workspace-copy.ts"),
    source("../app/_document-builder/document-builder.css"),
  ]);
  assert.doesNotMatch(documents, /window\.prompt/);
  assert.match(documents, /useModalFocus<HTMLFormElement>\(Boolean\(renameDecision\), closeRename\)/);
  assert.match(documents, /role="dialog" aria-modal="true" aria-labelledby="rename-document-title" aria-describedby="rename-document-description"/);
  assert.match(documents, /data-dialog-initial-focus required minLength=\{1\}/);
  assert.match(documents, /renameDecision\.kind === "standalone" \? 180 : 300/);
  assert.match(documents, /JSON\.stringify\(\{ action: "rename", title: renameTitle\.trim\(\) \}\)/);
  assert.match(copy, /renameDialogTitle: "Переименовать документ"/);
  assert.match(copy, /renameDialogTitle: "Hujjat nomini o‘zgartirish"/);
  assert.match(styles, /\.dbt-rename-dialog \{ width: min\(480px, 100%\); \}/);
});

test("document builder confirmations stay localized and own keyboard focus", async () => {
  const [builder, styles] = await Promise.all([
    source("../app/_document-builder/DocumentBuilderClient.tsx"),
    source("../app/_document-builder/document-builder.css"),
  ]);
  assert.doesNotMatch(builder, /window\.confirm/);
  assert.match(builder, /useModalFocus<HTMLElement>\(Boolean\(confirmationDecision\), closeConfirmation\)/);
  assert.match(builder, /role="dialog" aria-modal="true" aria-labelledby="builder-confirmation-title" aria-describedby="builder-confirmation-description"/);
  assert.match(builder, /className="cancel" data-dialog-initial-focus/);
  assert.match(builder, /"Konstruktordan chiqasizmi\?"/);
  assert.match(builder, /"Уйти из конструктора\?"/);
  assert.match(builder, /"Kelishuv bekor qilinsinmi\?"/);
  assert.match(builder, /"Отменить согласование\?"/);
  assert.match(builder, /if \(phase !== "builder" \|\| accessRole === "collaborator"\) return;/);
  assert.match(builder, /event\.defaultPrevented \|\| event\.button !== 0 \|\| event\.metaKey \|\| event\.ctrlKey/);
  assert.match(builder, /event\.returnValue = "";/);
  assert.match(builder, /allowNavigationRef\.current = true;[\s\S]*?window\.location\.assign\(decision\.href\)/);
  assert.match(builder, /agreementWarningShown\.current = true;[\s\S]*?pending\?\.\(\)/);
  assert.match(builder, /onChange=\{\(event\) => changeTitle\(event\.target\.value\)\}/);
  assert.match(styles, /\.dbt-confirm-dialog > button\.confirm \{[^}]*background: var\(--dbt-cta\);/);
});
