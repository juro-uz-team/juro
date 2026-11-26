
import { WorkspaceTitle } from "./WorkspaceTitle";
import { UserRound } from "lucide-react";
import type {
  AccountType,
  PlatformLocale,
  PlatformModule,
} from "../../lib/platform/routing";
import { ActionPlanClient } from "./ActionPlanClient";
import { ConsultationsClient } from "./ConsultationsClient";
import { DashboardClient } from "./DashboardClient";
import { CasesClient } from "./CasesClient";
import { TeamClient } from "./TeamClient";
import { AiLawyerClient } from "./AiLawyerClient";
import { BillingClient } from "./BillingClient";
import { DemoPaymentsClient } from "./DemoPaymentsClient";
import { ProfileSettingsClient } from "./ProfileSettingsClient";
import { DocumentReviewClient } from "./DocumentReviewClient";
import { HistoryClient } from "./HistoryClient";
import { ArchiveClient } from "./ArchiveClient";
import { HelpClient } from "./HelpClient";
import { MonitoringClient } from "./MonitoringClient";
import { CalendarClient } from "./CalendarClient";
import {
  LawyerDashboardClient,
  LawyerHubClient,
  LawyerScheduleClient,
} from "./LawyerWorkspaceClient";

const titles: Record<PlatformModule, { ru: string; uz: string; en: string }> = {
  dashboard: { ru: "Главная", uz: "Bosh sahifa", en: "Home" },
  "ai-chat": { ru: "AI-юрист", uz: "AI-yurist", en: "AI legal assistant" },
  cases: { ru: "Мои дела", uz: "Mening ishlarim", en: "My matters" },
  "document-review": { ru: "Проверить документ", uz: "Hujjatni tekshirish", en: "Review a document" },
  monitoring: {
    ru: "Мониторинг законодательства",
    uz: "Qonunchilik monitoringi",
    en: "Legal monitoring",
  },
  "action-plan": { ru: "План действий", uz: "Harakatlar rejasi", en: "Action plan" },
  calendar: { ru: "Календарь", uz: "Kalendar", en: "Calendar" },
  consultations: { ru: "Консультации", uz: "Maslahatlar", en: "Consultations" },
  history: { ru: "История", uz: "Tarix", en: "History" },
  archive: { ru: "Архив", uz: "Arxiv", en: "Archive" },
  team: { ru: "Команда", uz: "Jamoa", en: "Team" },
  billing: { ru: "Тариф и оплата", uz: "Tarif va to‘lov", en: "Plan and billing" },
  "demo-payments": { ru: "Демонстрация платежей", uz: "To‘lovlar namoyishi", en: "Payment demonstration" },
  security: { ru: "Безопасность", uz: "Xavfsizlik", en: "Security" },
  help: { ru: "Помощь", uz: "Yordam", en: "Help" },
  profile: { ru: "Профиль", uz: "Profil", en: "Profile" },
  settings: { ru: "Настройки языка", uz: "Til sozlamalari", en: "Language settings" },
};

const descriptions: Record<PlatformModule, { ru: string; uz: string; en: string }> = {
  dashboard: { ru: "", uz: "", en: "" },
  "ai-chat": {
    ru: "Опишите ситуацию. AI-помощник отделит факты от предположений и предложит проверяемые следующие шаги.",
    uz: "Vaziyatni yozing. AI-yordamchi faktlarni taxminlardan ajratib, tekshiriladigan keyingi qadamlarni taklif qiladi.",
    en: "Describe the situation. The AI assistant will separate facts from assumptions and suggest verifiable next steps.",
  },
  cases: {
    ru: "Дела объединяют документы, планы, сроки, доказательства и консультации.",
    uz: "Ishlar hujjatlar, rejalar, muddatlar, dalillar va maslahatlarni birlashtiradi.",
    en: "Matters bring documents, plans, deadlines, evidence and consultations together.",
  },
  "document-review": {
    ru: "Загрузите документ для проверки структуры и возможных рисков.",
    uz: "Tuzilma va ehtimoliy xavflarni tekshirish uchun hujjat yuklang.",
    en: "Upload a document to review its structure and potential risks.",
  },
  monitoring: {
    ru: "Настройте темы и получайте только подтверждённые обновления из официальных источников.",
    uz: "Mavzularni sozlang va faqat rasmiy manbalardan tasdiqlangan yangilanishlarni oling.",
    en: "Choose topics and receive only verified updates from official sources.",
  },
  "action-plan": {
    ru: "Создавайте план из подтверждённых фактов и отслеживайте реальные выполненные шаги.",
    uz: "Tasdiqlangan faktlardan reja yarating va haqiqiy bajarilgan qadamlarni kuzating.",
    en: "Build a plan from verified facts and track steps that have actually been completed.",
  },
  calendar: {
    ru: "Следите за сроками из планов и задач текущего пространства.",
    uz: "Joriy makondagi reja va vazifa muddatlarini kuzating.",
    en: "Track deadlines from plans and tasks in the current workspace.",
  },
  consultations: {
    ru: "Передавайте специалисту только выбранный вами контекст.",
    uz: "Mutaxassisga faqat siz tanlagan kontekstni topshiring.",
    en: "Share only the context you select with a specialist.",
  },
  history: {
    ru: "История формируется из реальных действий в делах и документах.",
    uz: "Tarix ishlar va hujjatlardagi haqiqiy harakatlardan tuziladi.",
    en: "History is built from actual activity in matters and documents.",
  },
  archive: {
    ru: "Архивные объекты скрыты из рабочих списков, но не удалены.",
    uz: "Arxivdagi obyektlar ish ro‘yxatlaridan yashiriladi, ammo o‘chirilmaydi.",
    en: "Archived items are hidden from working lists, but are not deleted.",
  },
  team: {
    ru: "Управляйте участниками пространства и их серверными правами.",
    uz: "Makon ishtirokchilari va ularning server huquqlarini boshqaring.",
    en: "Manage workspace members and their server-enforced permissions.",
  },
  billing: {
    ru: "Актуальные условия тарифа отображаются перед подтверждением оплаты.",
    uz: "Amaldagi tarif shartlari to‘lovni tasdiqlashdan oldin ko‘rsatiladi.",
    en: "Current plan terms are shown before you confirm payment.",
  },
  "demo-payments": {
    ru: "Изолированные записи симуляции не меняют реальные платежи и тариф.",
    uz: "Ajratilgan simulyatsiya yozuvlari haqiqiy to‘lov va tarifni o‘zgartirmaydi.",
    en: "Isolated simulation records do not change real payments or your plan.",
  },
  security: {
    ru: "Управляйте доступом, сессиями и передачей документов.",
    uz: "Kirish, sessiyalar va hujjat uzatishni boshqaring.",
    en: "Manage access, sessions and document sharing.",
  },
  help: {
    ru: "Инструкции по работе с инструментами JURO.",
    uz: "JURO vositalari bilan ishlash bo‘yicha yo‘riqnomalar.",
    en: "Guidance for using JURO tools.",
  },
  profile: {
    ru: "Профильные данные используются только в подтверждённых вами сценариях.",
    uz: "Profil ma’lumotlari faqat siz tasdiqlagan ssenariylarda ishlatiladi.",
    en: "Profile data is used only in workflows you approve.",
  },
  settings: {
    ru: "Переключение языка сохраняет текущий модуль и тип пространства.",
    uz: "Tilni almashtirish joriy modul va makon turini saqlaydi.",
    en: "Changing language preserves the current module and workspace type.",
  },
};

export function ModuleContent({
  locale,
  accountType,
  module,
  userName,
  workspaceId,
  publicUrlImportEnabled,
}: {
  locale: PlatformLocale;
  accountType: AccountType;
  module: PlatformModule;
  userName: string;
  workspaceId?: string;
  publicUrlImportEnabled: boolean;
}) {
  if (accountType === "lawyer" && module === "dashboard")
    return <LawyerDashboardClient locale={locale} userName={userName} />;
  if (accountType === "lawyer" && module === "consultations")
    return <LawyerHubClient locale={locale} />;
  if (accountType === "lawyer" && module === "calendar")
    return <LawyerScheduleClient locale={locale} />;
  if (module === "action-plan")
    return <ActionPlanClient locale={locale} accountType={accountType} />;
  if (module === "calendar") return <CalendarClient locale={locale} />;
  if (module === "consultations")
    return <ConsultationsClient locale={locale} accountType={accountType} workspaceId={workspaceId} />;
  if (module === "dashboard")
    return (
      <DashboardClient
        locale={locale}
        accountType={accountType}
        userName={userName}
      />
    );
  if (module === "cases")
    return <CasesClient locale={locale} accountType={accountType} />;
  if (module === "team") return <TeamClient key={workspaceId} locale={locale} />;
  if (module === "ai-chat") return <AiLawyerClient locale={locale} />;
  if (module === "billing")
    return (
      <BillingClient
        locale={locale}
        accountType={accountType}
        workspaceId={workspaceId}
      />
    );
  if (module === "demo-payments")
    return (
      <DemoPaymentsClient
        locale={locale}
        accountType={accountType}
        workspaceId={workspaceId}
      />
    );
  if (module === "profile" || module === "settings" || module === "security")
    return (
      <ProfileSettingsClient
        locale={locale}
        accountType={accountType}
        view={module === "security" ? "security" : module}
      />
    );
  if (module === "document-review")
    return (
      <DocumentReviewClient
        locale={locale}
        publicUrlImportEnabled={publicUrlImportEnabled}
      />
    );
  if (module === "history") return <HistoryClient locale={locale} />;
  if (module === "archive")
    return <ArchiveClient locale={locale} accountType={accountType} />;
  if (module === "help")
    return <HelpClient locale={locale} accountType={accountType} />;
  if (module === "monitoring")
    return <MonitoringClient locale={locale} accountType={accountType} />;
  const Icon = UserRound;
  return (
    <section className="platform-module workspace-page">
      <WorkspaceTitle icon={<Icon />} title={titles[module][locale]} description={descriptions[module][locale]} />
      <div className="platform-empty platform-module-empty">
        <Icon />
        <h2>
          {{ ru: "Рабочих записей пока нет", uz: "Hozircha ish yozuvlari yo‘q", en: "No workspace records yet" }[locale]}
        </h2>
        <p>
          {{
            ru: "Раздел подключён к отдельному URL. Реальные записи появятся после создания соответствующего объекта.",
            uz: "Bo‘lim alohida URLga ulangan. Tegishli obyekt yaratilgandan keyin haqiqiy yozuvlar paydo bo‘ladi.",
            en: "This section has its own URL. Records will appear after you create the relevant item.",
          }[locale]}
        </p>
      </div>
    </section>
  );
}
