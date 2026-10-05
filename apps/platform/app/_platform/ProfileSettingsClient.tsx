"use client";

import { Select } from "../_components/Select";

import { usePlatformBasePath } from "./PlatformRouteContext";
import { LawyerProfessionalProfile } from "./LawyerProfessionalProfile";
import { NotificationPreferencesPanel } from "./NotificationPreferencesPanel";
import { MemoryPanel } from "./MemoryPanel";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated profile data is hydrated after the first browser render */

import Link from "next/link";
import { Building2, CircleAlert, Copy, Database, Download, KeyRound, Languages, LoaderCircle, LogOut, MailCheck, MonitorSmartphone, RefreshCcw, Save, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { formatPlatformDateTime } from "../../lib/platform/date-time";
import { isLocale, type AccountType, type PlatformLocale } from "../../lib/platform/routing";
import { performLogout } from "./logout-client";

type View = "profile" | "settings" | "security" | "privacy";
type ProfileData = {
  profile: {
    email: string; fullName: string | null; phone: string | null; locale: string; accountType: string;
    companyName: string | null; organizationRole: string | null; primaryGoal: string | null; timezone: string; createdAt: string;
  };
  workspace: { name: string; type: string; locale: string };
  role: string;
  consents: Array<{ type: string; version: string; grantedAt: string; revokedAt: string | null }>;
  acceptances: Array<{
    type: string;
    version: string;
    locale: string | null;
    contentSha256: string | null;
    acceptedAt: string;
    status: string;
  }>;
  deletionRequest: {
    id: string;
    status: string;
    deletionMode: "immediate" | "recoverable_30d";
    requestedAt: string;
    verifiedAt: string | null;
    scheduledPurgeAt: string | null;
    purgeStartedAt: string | null;
    purgeIrreversibleAt: string | null;
    failureCode: string | null;
    cancelable: number | boolean;
    retryable: number | boolean;
  } | null;
};
type Session = {
  id: string;
  createdAt: string;
  authenticatedAt: string | null;
  lastSeenAt: string;
  expiresAt: string;
  idleExpiresAt: string | null;
  authMethod: string;
  assuranceLevel: string;
  deviceName: string | null;
  countryCode: string | null;
  regionCode: string | null;
  isCurrent: number | boolean;
};
type MfaStatus = {
  available: boolean;
  canManage: boolean;
  enabled: boolean;
  verifiedAt: string | null;
  backupCodesRemaining: number;
  reason?: string;
};
type MfaSetup = {
  credentialId: string;
  secret: string;
  otpauthUri: string;
  expiresAt: string;
};
type DeletionChallenge = {
  challengeId: string;
  destination: string;
  expiresInSeconds: number;
};
type EmailChangeStatus = {
  available: boolean;
  canManage: boolean;
  reason?: string | null;
  currentEmail?: string;
  active: {
    challengeId: string;
    currentDestination: string;
    newDestination: string;
    expiresAt: string;
  } | null;
};

const PROFILE_COPY_RU = {
  profileLoadFailed: "Не удалось загрузить профиль.",
  emailChangeSettingsLoadFailed: "Не удалось загрузить настройки смены email.",
  sessionsLoadFailed: "Не удалось загрузить сессии.",
  mfaSettingsLoadFailed: "Не удалось загрузить настройки 2FA.",
  saveFailed: "Не удалось сохранить изменения.",
  saveSucceeded: "Изменения сохранены.",
  emailChangeFailed: "Не удалось изменить email.",
  emailChangeCodesAccepted: "Почтовый сервис принял два отдельных письма для текущего и нового адресов.",
  networkFailed: "Не удалось связаться с сервером. Повторите запрос.",
  emailChangeCancelFailed: "Не удалось отменить проверку.",
  emailChangeCanceled: "Смена email отменена.",
  allSessionsConfirmation: "Завершить все локальные сессии JURO и выйти?",
  sessionsCloseFailed: "Не удалось завершить сессии.",
  otherSessionsCloseFailed: "Не удалось завершить другие сессии.",
  currentSessionConfirmation: "Завершить текущую сессию JURO?",
  sessionCloseFailed: "Не удалось завершить сессию.",
  sessionClosed: "Сессия завершена.",
  mfaSetupFailed: "Не удалось начать настройку 2FA.",
  mfaEnableFailed: "Не удалось включить 2FA.",
  mfaEnabledNotice: "2FA включена. Сохраните резервные коды сейчас.",
  mfaDisableConfirmation: "Отключить двухфакторную защиту и завершить остальные сессии?",
  operationFailed: "Не удалось выполнить операцию.",
  backupCodesRegenerated: "Создан новый набор. Старые резервные коды отозваны.",
  mfaDisabled: "2FA отключена.",
  backupCodesCopied: "Резервные коды скопированы.",
  backupCodesCopyFailed: "Не удалось скопировать. Сохраните коды вручную.",
  deletionRequestFailed: "Не удалось создать запрос.",
  deletionRecoverableQueued: "Удаление запланировано через 30 дней. До начала очистки запрос можно отменить после повторного входа.",
  deletionImmediateQueued: "Немедленная очистка поставлена в защищённую очередь. Сессии завершены.",
  deletionCancelFailed: "Не удалось отменить запрос на удаление.",
  deletionCanceled: "Запрос на удаление отменён. Данные аккаунта сохранены.",
  deletionRetryFailed: "Не удалось повторно запустить очистку.",
  deletionRetryQueued: "Очистка снова поставлена в защищённую очередь.",
  workspaceCreateFailed: "Не удалось создать бизнес-пространство.",
  loadingSettings: "Загрузка настроек",
  profileTitle: "Профиль",
  securityTitle: "Безопасность",
  privacyTitle: "Приватность и данные",
  settingsTitle: "Настройки",
  headerDescription: "Данные и права изменяются через защищённые серверные операции.",
  accountSettings: "Настройки аккаунта",
  profileNav: "Профиль",
  settingsNav: "Настройки",
  securityNav: "Безопасность",
  privacyNav: "Приватность",
  retryLoad: "Повторить загрузку",
  basicData: "Основные данные",
  name: "Имя",
  emailChangeHint: "Смена email требует отдельного подтверждения.",
  phone: "Телефон",
  workspace: "Пространство",
  language: "Язык",
  timezone: "Часовой пояс",
  organization: "Организация",
  organizationRole: "Роль в организации",
  saveChanges: "Сохранить изменения",
  newBusinessWorkspace: "Новое бизнес-пространство",
  businessWorkspaceDescription: "Создайте отдельный контур для документов и дел организации. Вы станете владельцем; формальная государственная проверка компании на этом этапе не требуется.",
  fullNameLabel: "Полное наименование",
  shortNameLabel: "Краткое наименование",
  createAndOpen: "Создать и перейти",
  secureEmailChange: "Защищённая смена email",
  emailChangeDescription: "JURO отправит разные коды на текущий и новый адреса. Изменение применяется только после проверки обоих кодов и завершает остальные локальные сессии JURO.",
  emailChangeLocalOnly: "Смена email доступна только из локальной сессии JURO.",
  emailChangeUnavailable: "Почтовая отправка ещё не настроена. Незавершённая проверка не создаётся.",
  newEmail: "Новый email",
  sendTwoCodes: "Отправить два кода",
  emailChangeVerification: "Подтверждение смены email",
  currentEmailCode: "Код с текущего email",
  newEmailCode: "Код с нового email",
  verifyAndChange: "Проверить и изменить",
  cancel: "Отмена",
  sessionsTitle: "Локальные сессии JURO",
  sessionsDescription: "Здесь показаны локальные входы в JURO по паролю или коду. Сессии внешнего защищённого провайдера управляются у него и в этот список не входят.",
  current: "Текущая",
  unknownDevice: "Неизвестное устройство",
  lastActivity: "Последняя активность",
  signIn: "Вход",
  approximateRegion: "Примерный регион",
  regionUnknown: "не определён",
  until: "до",
  endSession: "Завершить",
  noSessions: "Активные локальные сессии JURO не найдены.",
  endOtherSessions: "Завершить остальные",
  endAllSessions: "Завершить все сессии JURO",
  twoFactor: "Двухфакторная защита",
  mfaLocalOnly: "Управление 2FA доступно только из локальной сессии JURO. Внешняя защищённая сессия не считается вторым фактором JURO.",
  mfaUnavailable: "Серверный ключ шифрования 2FA ещё не подключён. Настройка скрыта и не создаёт незавершённый фактор.",
  mfaOff: "Статус: выключена",
  mfaOffDescription: "После включения каждый вход в JURO потребует шестизначный TOTP-код или одноразовый резервный код.",
  enableMfa: "Подключить 2FA",
  mfaSetup: "Настройка 2FA",
  mfaSetupDescription: "Добавьте JURO в приложение-аутентификатор. Секрет показан только во время этой настройки.",
  openAuthenticator: "Открыть в аутентификаторе",
  setupValidUntil: "Настройка действует до",
  appCode: "Код из приложения",
  confirmAndEnable: "Подтвердить и включить",
  mfaOn: "2FA включена",
  verificationCode: "Код подтверждения",
  newBackupCodes: "Новые резервные коды",
  disableMfa: "Отключить 2FA",
  saveCodesNow: "Сохраните эти коды сейчас",
  backupCodesDescription: "После закрытия страницы JURO больше не покажет этот набор. Каждый код работает один раз.",
  copyCodes: "Скопировать коды",
  securityMechanisms: "Механизмы защиты",
  cookieSecurity: "HttpOnly, Secure, SameSite=Lax cookie",
  sessionLifetime: "Абсолютный и семидневный idle-срок сессии",
  totpSecurity: "TOTP replay-fence и одноразовые резервные коды",
  auditSecurity: "Append-only цепочка событий безопасности",
  dataExport: "Экспорт данных",
  exportDescription: "Скачайте переносимый JSON с данными профиля, делами, метаданными документов, согласиями и вашей историей действий. Содержимое приватных файлов не включается автоматически.",
  downloadExport: "Скачать экспорт",
  consentHistory: "История согласий",
  noRecords: "Записей пока нет.",
  deleteAccount: "Удаление аккаунта",
  deletionBlockedDescription: "Автоматическая очистка приостановлена: данные не удалены. Устраните ограничение или отмените восстанавливаемый запрос.",
  deletionRecoverableDescription: "Запрос подтверждён. До указанного срока аккаунт можно восстановить, отменив удаление после свежего входа.",
  deletionImmediateDescription: "Немедленная очистка подтверждена и выполняется защищённой фоновой задачей.",
  recoveryPeriod: "30 дней на восстановление",
  noRecoveryPeriod: "Без периода восстановления",
  cancelDeletion: "Отменить удаление",
  retryDeletion: "Повторить очистку",
  requestDeletion: "Запросить удаление аккаунта",
  requestDeletionDescription: "После подтверждения JURO завершит все сессии и удалит пользовательские данные, сохранив только минимальные записи, обязательные для безопасности, согласий и финансового учёта.",
  whenDelete: "Когда удалить данные",
  afterThirtyDays: "Через 30 дней",
  afterThirtyDaysDescription: " Можно войти снова и отменить удаление до начала очистки.",
  immediately: "Немедленно",
  immediatelyDescription: " Очистку нельзя отменить после запуска фоновой задачи.",
  getEmailCode: "Получить код по email",
  emailCode: "Код из письма",
  controlConfirmation: "Контрольное подтверждение",
  confirmRequest: "Подтвердить запрос",
} satisfies Record<string, string>;

type ProfileCopyKey = keyof typeof PROFILE_COPY_RU;

const PROFILE_COPY: Record<PlatformLocale, Record<ProfileCopyKey, string>> = {
  ru: PROFILE_COPY_RU,
  uz: {
    profileLoadFailed: "Profilni yuklab bo‘lmadi.",
    emailChangeSettingsLoadFailed: "Emailni almashtirish sozlamalarini yuklab bo‘lmadi.",
    sessionsLoadFailed: "Sessiyalarni yuklab bo‘lmadi.",
    mfaSettingsLoadFailed: "2FA sozlamalarini yuklab bo‘lmadi.",
    saveFailed: "O‘zgarishlarni saqlab bo‘lmadi.",
    saveSucceeded: "O‘zgarishlar saqlandi.",
    emailChangeFailed: "Emailni o‘zgartirib bo‘lmadi.",
    emailChangeCodesAccepted: "Pochta xizmati joriy va yangi manzillar uchun ikkita alohida xatni qabul qildi.",
    networkFailed: "Server bilan bog‘lanib bo‘lmadi. So‘rovni takrorlang.",
    emailChangeCancelFailed: "Tekshiruvni bekor qilib bo‘lmadi.",
    emailChangeCanceled: "Emailni almashtirish bekor qilindi.",
    allSessionsConfirmation: "Barcha mahalliy JURO sessiyalarini yakunlab chiqasizmi?",
    sessionsCloseFailed: "Sessiyalarni yakunlab bo‘lmadi.",
    otherSessionsCloseFailed: "Boshqa sessiyalarni yakunlab bo‘lmadi.",
    currentSessionConfirmation: "Joriy JURO sessiyasini yakunlaysizmi?",
    sessionCloseFailed: "Sessiyani yakunlab bo‘lmadi.",
    sessionClosed: "Sessiya yakunlandi.",
    mfaSetupFailed: "2FA sozlashni boshlab bo‘lmadi.",
    mfaEnableFailed: "2FA ni yoqib bo‘lmadi.",
    mfaEnabledNotice: "2FA yoqildi. Zaxira kodlarni hozir saqlang.",
    mfaDisableConfirmation: "Ikki bosqichli himoyani o‘chirib, boshqa sessiyalarni yakunlaysizmi?",
    operationFailed: "Amalni bajarib bo‘lmadi.",
    backupCodesRegenerated: "Yangi to‘plam yaratildi. Eski zaxira kodlar bekor qilindi.",
    mfaDisabled: "2FA o‘chirildi.",
    backupCodesCopied: "Zaxira kodlar nusxalandi.",
    backupCodesCopyFailed: "Nusxalab bo‘lmadi. Kodlarni qo‘lda saqlang.",
    deletionRequestFailed: "So‘rovni yaratib bo‘lmadi.",
    deletionRecoverableQueued: "O‘chirish 30 kundan keyin rejalashtirildi. Tozalash boshlanguncha qayta kirib so‘rovni bekor qilish mumkin.",
    deletionImmediateQueued: "Darhol tozalash himoyalangan navbatga qo‘yildi. Sessiyalar yakunlandi.",
    deletionCancelFailed: "O‘chirish so‘rovini bekor qilib bo‘lmadi.",
    deletionCanceled: "O‘chirish so‘rovi bekor qilindi. Hisob ma’lumotlari saqlandi.",
    deletionRetryFailed: "Tozalashni qayta ishga tushirib bo‘lmadi.",
    deletionRetryQueued: "Tozalash himoyalangan navbatga qayta qo‘yildi.",
    workspaceCreateFailed: "Biznes makonini yaratib bo‘lmadi.",
    loadingSettings: "Sozlamalar yuklanmoqda",
    profileTitle: "Profil",
    securityTitle: "Xavfsizlik",
    privacyTitle: "Maxfiylik va ma’lumotlar",
    settingsTitle: "Sozlamalar",
    headerDescription: "Ma’lumotlar va huquqlar himoyalangan server amallari orqali o‘zgartiriladi.",
    accountSettings: "Hisob sozlamalari",
    profileNav: "Profil",
    settingsNav: "Sozlamalar",
    securityNav: "Xavfsizlik",
    privacyNav: "Maxfiylik",
    retryLoad: "Qayta yuklash",
    basicData: "Asosiy ma’lumotlar",
    name: "Ism",
    emailChangeHint: "Emailni o‘zgartirish alohida tasdiqni talab qiladi.",
    phone: "Telefon",
    workspace: "Makon",
    language: "Til",
    timezone: "Vaqt mintaqasi",
    organization: "Tashkilot",
    organizationRole: "Tashkilotdagi rol",
    saveChanges: "O‘zgarishlarni saqlash",
    newBusinessWorkspace: "Yangi biznes makoni",
    businessWorkspaceDescription: "Tashkilot hujjatlari va ishlari uchun alohida makon yarating. Siz egasi bo‘lasiz; hozircha kompaniyani davlat orqali rasmiy tekshirish talab qilinmaydi.",
    fullNameLabel: "To‘liq nomi",
    shortNameLabel: "Qisqa nomi",
    createAndOpen: "Yaratish va o‘tish",
    secureEmailChange: "Himoyalangan email almashtirish",
    emailChangeDescription: "JURO joriy va yangi manzillarga turli kodlarni yuboradi. O‘zgarish faqat ikkala kod tekshirilgach qo‘llanadi va boshqa mahalliy JURO sessiyalarini yakunlaydi.",
    emailChangeLocalOnly: "Emailni almashtirish faqat mahalliy JURO sessiyasida mavjud.",
    emailChangeUnavailable: "Pochta yuborish hali sozlanmagan. Tugallanmagan tekshiruv yaratilmaydi.",
    newEmail: "Yangi email",
    sendTwoCodes: "Ikki kodni yuborish",
    emailChangeVerification: "Emailni almashtirishni tasdiqlash",
    currentEmailCode: "Joriy email kodi",
    newEmailCode: "Yangi email kodi",
    verifyAndChange: "Tekshirish va almashtirish",
    cancel: "Bekor qilish",
    sessionsTitle: "Mahalliy JURO sessiyalari",
    sessionsDescription: "Bu yerda parol yoki kod orqali bajarilgan mahalliy JURO kirishlari ko‘rsatiladi. Tashqi himoyalangan provayder sessiyalari uning tizimida boshqariladi va bu ro‘yxatga kirmaydi.",
    current: "Joriy",
    unknownDevice: "Noma’lum qurilma",
    lastActivity: "Oxirgi faollik",
    signIn: "Kirish",
    approximateRegion: "Taxminiy hudud",
    regionUnknown: "aniqlanmadi",
    until: "gacha",
    endSession: "Yakunlash",
    noSessions: "Faol mahalliy JURO sessiyalari topilmadi.",
    endOtherSessions: "Boshqalarini yakunlash",
    endAllSessions: "Barcha JURO sessiyalarini yakunlash",
    twoFactor: "Ikki bosqichli himoya",
    mfaLocalOnly: "2FA boshqaruvi faqat mahalliy JURO sessiyasida mavjud. Tashqi himoyalangan sessiya JURO ikkinchi omili hisoblanmaydi.",
    mfaUnavailable: "2FA server shifrlash kaliti hali ulanmagan. Sozlash yashirilgan va tugallanmagan omil yaratmaydi.",
    mfaOff: "Holat: o‘chirilgan",
    mfaOffDescription: "Yoqilgandan so‘ng JURO ga har bir kirish olti xonali TOTP yoki bir martalik zaxira kodni talab qiladi.",
    enableMfa: "2FA ni ulash",
    mfaSetup: "2FA sozlash",
    mfaSetupDescription: "JURO ni autentifikator ilovasiga qo‘shing. Sir faqat shu sozlash vaqtida ko‘rsatiladi.",
    openAuthenticator: "Autentifikatorda ochish",
    setupValidUntil: "Sozlash muddati",
    appCode: "Ilovadagi kod",
    confirmAndEnable: "Tasdiqlash va yoqish",
    mfaOn: "2FA yoqilgan",
    verificationCode: "Tasdiqlash kodi",
    newBackupCodes: "Yangi zaxira kodlar",
    disableMfa: "2FA ni o‘chirish",
    saveCodesNow: "Bu kodlarni hozir saqlang",
    backupCodesDescription: "Sahifa yopilgach JURO bu to‘plamni qayta ko‘rsatmaydi. Har bir kod bir marta ishlaydi.",
    copyCodes: "Kodlarni nusxalash",
    securityMechanisms: "Himoya mexanizmlari",
    cookieSecurity: "HttpOnly, Secure, SameSite=Lax cookie",
    sessionLifetime: "Mutlaq va yetti kunlik idle sessiya muddati",
    totpSecurity: "TOTP replay-fence va bir martalik zaxira kodlar",
    auditSecurity: "Append-only xavfsizlik hodisalari zanjiri",
    dataExport: "Ma’lumotlarni eksport qilish",
    exportDescription: "Profil, ishlar, hujjat metama’lumotlari, roziliklar va harakatlar tarixini JSON formatida yuklab oling. Maxfiy fayllar mazmuni avtomatik kiritilmaydi.",
    downloadExport: "Eksportni yuklab olish",
    consentHistory: "Roziliklar tarixi",
    noRecords: "Hozircha yozuvlar yo‘q.",
    deleteAccount: "Hisobni o‘chirish",
    deletionBlockedDescription: "Avtomatik tozalash to‘xtatildi: ma’lumotlar o‘chirilmagan. Cheklovni bartaraf eting yoki tiklanadigan so‘rovni bekor qiling.",
    deletionRecoverableDescription: "So‘rov tasdiqlandi. Ko‘rsatilgan muddatgacha yangi kirishdan so‘ng o‘chirishni bekor qilib hisobni saqlash mumkin.",
    deletionImmediateDescription: "Darhol tozalash tasdiqlandi va himoyalangan fon vazifasi orqali bajarilmoqda.",
    recoveryPeriod: "Tiklash uchun 30 kun",
    noRecoveryPeriod: "Tiklash muddatlarisiz",
    cancelDeletion: "O‘chirishni bekor qilish",
    retryDeletion: "Tozalashni takrorlash",
    requestDeletion: "Hisobni o‘chirishni so‘rash",
    requestDeletionDescription: "Tasdiqlangach JURO barcha sessiyalarni yakunlaydi va foydalanuvchi ma’lumotlarini o‘chiradi, faqat xavfsizlik, rozilik va moliyaviy hisob uchun zarur minimal yozuvlarni saqlaydi.",
    whenDelete: "Ma’lumotlarni qachon o‘chirish",
    afterThirtyDays: "30 kundan keyin",
    afterThirtyDaysDescription: " Tozalash boshlanguncha qayta kirib o‘chirishni bekor qilish mumkin.",
    immediately: "Darhol",
    immediatelyDescription: " Fon vazifasi boshlangach tozalashni bekor qilib bo‘lmaydi.",
    getEmailCode: "Email orqali kod olish",
    emailCode: "Xatdagi kod",
    controlConfirmation: "Nazorat tasdig‘i",
    confirmRequest: "So‘rovni tasdiqlash",
  },
  en: {
    profileLoadFailed: "We could not load your profile.",
    emailChangeSettingsLoadFailed: "We could not load the email change settings.",
    sessionsLoadFailed: "We could not load your sessions.",
    mfaSettingsLoadFailed: "We could not load the 2FA settings.",
    saveFailed: "We could not save your changes.",
    saveSucceeded: "Your changes have been saved.",
    emailChangeFailed: "We could not change your email address.",
    emailChangeCodesAccepted: "The email service accepted two separate messages for your current and new addresses.",
    networkFailed: "We could not reach the server. Please try again.",
    emailChangeCancelFailed: "We could not cancel the verification.",
    emailChangeCanceled: "The email change has been cancelled.",
    allSessionsConfirmation: "End all local JURO sessions and sign out?",
    sessionsCloseFailed: "We could not end the sessions.",
    otherSessionsCloseFailed: "We could not end the other sessions.",
    currentSessionConfirmation: "End your current JURO session?",
    sessionCloseFailed: "We could not end the session.",
    sessionClosed: "The session has ended.",
    mfaSetupFailed: "We could not start 2FA setup.",
    mfaEnableFailed: "We could not enable 2FA.",
    mfaEnabledNotice: "2FA is enabled. Save your backup codes now.",
    mfaDisableConfirmation: "Disable two-factor authentication and end your other sessions?",
    operationFailed: "We could not complete the operation.",
    backupCodesRegenerated: "A new set has been created. Your old backup codes have been revoked.",
    mfaDisabled: "2FA has been disabled.",
    backupCodesCopied: "Backup codes copied.",
    backupCodesCopyFailed: "We could not copy the codes. Save them manually.",
    deletionRequestFailed: "We could not create the request.",
    deletionRecoverableQueued: "Deletion is scheduled in 30 days. You can sign in again and cancel the request before deletion begins.",
    deletionImmediateQueued: "Immediate deletion has been added to the secure queue. Your sessions have ended.",
    deletionCancelFailed: "We could not cancel the deletion request.",
    deletionCanceled: "The deletion request has been cancelled. Your account data has been retained.",
    deletionRetryFailed: "We could not restart deletion.",
    deletionRetryQueued: "Deletion has been added to the secure queue again.",
    workspaceCreateFailed: "We could not create the business workspace.",
    loadingSettings: "Loading settings",
    profileTitle: "Profile",
    securityTitle: "Security",
    privacyTitle: "Privacy & data",
    settingsTitle: "Settings",
    headerDescription: "Your data and permissions are updated through secure server-side operations.",
    accountSettings: "Account settings",
    profileNav: "Profile",
    settingsNav: "Settings",
    securityNav: "Security",
    privacyNav: "Privacy",
    retryLoad: "Try loading again",
    basicData: "Basic information",
    name: "Name",
    emailChangeHint: "Changing your email address requires separate verification.",
    phone: "Phone",
    workspace: "Workspace",
    language: "Language",
    timezone: "Time zone",
    organization: "Organization",
    organizationRole: "Role in the organization",
    saveChanges: "Save changes",
    newBusinessWorkspace: "New business workspace",
    businessWorkspaceDescription: "Create a separate workspace for your organization’s documents and matters. You will become its owner; formal government verification is not required at this stage.",
    fullNameLabel: "Legal name",
    shortNameLabel: "Short name",
    createAndOpen: "Create and open",
    secureEmailChange: "Secure email change",
    emailChangeDescription: "JURO will send separate codes to your current and new addresses. The change is applied only after both codes are verified and ends your other local JURO sessions.",
    emailChangeLocalOnly: "You can change your email address only from a local JURO session.",
    emailChangeUnavailable: "Email delivery is not configured yet. No incomplete verification has been created.",
    newEmail: "New email address",
    sendTwoCodes: "Send two codes",
    emailChangeVerification: "Verify the email change",
    currentEmailCode: "Code sent to your current email",
    newEmailCode: "Code sent to your new email",
    verifyAndChange: "Verify and change",
    cancel: "Cancel",
    sessionsTitle: "Local JURO sessions",
    sessionsDescription: "These are local JURO sign-ins completed with a password or code. Sessions managed by an external identity provider are controlled there and are not included.",
    current: "Current",
    unknownDevice: "Unknown device",
    lastActivity: "Last activity",
    signIn: "Signed in",
    approximateRegion: "Approximate region",
    regionUnknown: "not available",
    until: "until",
    endSession: "End session",
    noSessions: "No active local JURO sessions were found.",
    endOtherSessions: "End other sessions",
    endAllSessions: "End all JURO sessions",
    twoFactor: "Two-factor authentication",
    mfaLocalOnly: "You can manage 2FA only from a local JURO session. A session from an external identity provider does not count as a JURO second factor.",
    mfaUnavailable: "The server-side 2FA encryption key is not configured yet. Setup remains unavailable and no incomplete factor will be created.",
    mfaOff: "Status: off",
    mfaOffDescription: "Once enabled, every JURO sign-in will require a six-digit TOTP code or a single-use backup code.",
    enableMfa: "Set up 2FA",
    mfaSetup: "Set up 2FA",
    mfaSetupDescription: "Add JURO to your authenticator app. This secret is shown only during setup.",
    openAuthenticator: "Open in authenticator",
    setupValidUntil: "Setup is valid until",
    appCode: "Code from the app",
    confirmAndEnable: "Confirm and enable",
    mfaOn: "2FA is enabled",
    verificationCode: "Verification code",
    newBackupCodes: "New backup codes",
    disableMfa: "Disable 2FA",
    saveCodesNow: "Save these codes now",
    backupCodesDescription: "JURO will not show this set again after you leave the page. Each code can be used once.",
    copyCodes: "Copy codes",
    securityMechanisms: "Security controls",
    cookieSecurity: "HttpOnly, Secure, SameSite=Lax cookies",
    sessionLifetime: "Absolute session lifetime and seven-day idle expiry",
    totpSecurity: "TOTP replay protection and single-use backup codes",
    auditSecurity: "Append-only security event chain",
    dataExport: "Export data",
    exportDescription: "Download a portable JSON file with your profile, matters, document metadata, consents, and activity history. Private file contents are not included automatically.",
    downloadExport: "Download export",
    consentHistory: "Consent history",
    noRecords: "No records yet.",
    deleteAccount: "Delete account",
    deletionBlockedDescription: "Automatic deletion is paused and no data has been deleted. Resolve the restriction or cancel the recoverable request.",
    deletionRecoverableDescription: "The request is confirmed. You can keep the account until the stated date by signing in again and cancelling deletion.",
    deletionImmediateDescription: "Immediate deletion is confirmed and is being processed by a secure background task.",
    recoveryPeriod: "30-day recovery period",
    noRecoveryPeriod: "No recovery period",
    cancelDeletion: "Cancel deletion",
    retryDeletion: "Retry deletion",
    requestDeletion: "Request account deletion",
    requestDeletionDescription: "After confirmation, JURO will end all sessions and delete user data, retaining only the minimum records required for security, consent, and financial record-keeping.",
    whenDelete: "When should we delete your data?",
    afterThirtyDays: "After 30 days",
    afterThirtyDaysDescription: " You can sign in again and cancel deletion before the process begins.",
    immediately: "Immediately",
    immediatelyDescription: " Deletion cannot be cancelled after the background task starts.",
    getEmailCode: "Get a code by email",
    emailCode: "Code from the email",
    controlConfirmation: "Type DELETE to confirm",
    confirmRequest: "Confirm request",
  },
};

function localizedMessage(
  locale: PlatformLocale,
  values: Record<PlatformLocale, string>,
): string {
  return values[locale];
}

export function ProfileSettingsClient({ locale, accountType, view }: { locale: PlatformLocale; accountType: AccountType; view: View }) {
  const copy = PROFILE_COPY[locale];
  const base = usePlatformBasePath();
  const [data, setData] = useState<ProfileData | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ fullName: "", phone: "", locale, timezone: "Asia/Tashkent", companyName: "", organizationRole: "" });
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletionCode, setDeletionCode] = useState("");
  const [deletionChallenge, setDeletionChallenge] = useState<DeletionChallenge | null>(null);
  const [deletionMode, setDeletionMode] = useState<"immediate" | "recoverable_30d">("recoverable_30d");
  const [mfa, setMfa] = useState<MfaStatus | null>(null);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [emailChange, setEmailChange] = useState<EmailChangeStatus | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [currentEmailCode, setCurrentEmailCode] = useState("");
  const [newEmailCode, setNewEmailCode] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [sessionAction, setSessionAction] = useState<string | null>(null);
  const [businessWorkspace, setBusinessWorkspace] = useState({
    requestId: "",
    fullName: "",
    shortName: "",
  });
  const mfaSetupRegion = useRef<HTMLDivElement>(null);
  const backupCodesRegion = useRef<HTMLDivElement>(null);
  const emailChangeRegion = useRef<HTMLDivElement>(null);
  const logoutStarted = useRef(false);
  const sessionActionPending = useRef(false);

  async function finishLogout() {
    if (logoutStarted.current) return;
    logoutStarted.current = true;
    setLoggingOut(true);
    setData(null);
    setSessions([]);
    setMfa(null);
    setMfaSetup(null);
    setBackupCodes([]);
    setEmailChange(null);
    setForm({ fullName: "", phone: "", locale, timezone: "Asia/Tashkent", companyName: "", organizationRole: "" });
    setNewEmail("");
    setMfaCode("");
    setCurrentEmailCode("");
    setNewEmailCode("");
    setDeletionCode("");
    setDeletionChallenge(null);
    setDeleteConfirmation("");
    setBusinessWorkspace({ requestId: "", fullName: "", shortName: "" });
    setError("");
    setNotice("");
    await performLogout(locale);
  }

  const load = useCallback(async () => {
    setError("");
    try {
      const profileResponse = await fetch(`/api/platform/profile?lang=${locale}`, {
        cache: "no-store",
        headers: { "x-juro-locale": locale },
      });
      const profileBody = await profileResponse.json() as ProfileData & { error?: string };
      if (!profileResponse.ok) throw new Error(profileBody.error || copy.profileLoadFailed);
      setData(profileBody);
      setForm({
        fullName: profileBody.profile.fullName || "",
        phone: profileBody.profile.phone || "",
        locale: isLocale(profileBody.profile.locale)
          ? profileBody.profile.locale
          : locale,
        timezone: profileBody.profile.timezone,
        companyName: profileBody.profile.companyName || "",
        organizationRole: profileBody.profile.organizationRole || "",
      });
      if (view === "profile" || view === "settings") {
        const emailChangeResponse = await fetch(
          `/api/platform/security/email-change?lang=${locale}`,
          {
            cache: "no-store",
            headers: { "x-juro-locale": locale },
          },
        );
        const emailChangeBody = await emailChangeResponse.json() as
          EmailChangeStatus & { error?: string };
        if (!emailChangeResponse.ok) {
          throw new Error(
            emailChangeBody.error || copy.emailChangeSettingsLoadFailed,
          );
        }
        setEmailChange(emailChangeBody);
      }
      if (view === "security") {
        const sessionResponse = await fetch(
          `/api/platform/security/sessions?lang=${locale}`,
          {
            cache: "no-store",
            headers: { "x-juro-locale": locale },
          },
        );
        const sessionBody = await sessionResponse.json() as { sessions?: Session[]; error?: string };
        if (!sessionResponse.ok) {
          throw new Error(sessionBody.error || copy.sessionsLoadFailed);
        }
        setSessions(sessionBody.sessions ?? []);
        const mfaResponse = await fetch(
          `/api/platform/security/mfa?lang=${locale}`,
          {
            cache: "no-store",
            headers: { "x-juro-locale": locale },
          },
        );
        const mfaBody = await mfaResponse.json() as MfaStatus & { error?: string };
        if (!mfaResponse.ok) {
          throw new Error(mfaBody.error || copy.mfaSettingsLoadFailed);
        }
        setMfa(mfaBody);
      }
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [copy, locale, view]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (mfaSetup) mfaSetupRegion.current?.focus();
  }, [mfaSetup]);
  useEffect(() => {
    if (backupCodes.length > 0) backupCodesRegion.current?.focus();
  }, [backupCodes.length]);
  useEffect(() => {
    if (emailChange?.active) emailChangeRegion.current?.focus();
  }, [emailChange?.active]);

  async function retryLoad() {
    setRetrying(true);
    try {
      await load();
    } finally {
      setRetrying(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    const response = await fetch(`/api/platform/profile?lang=${locale}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-juro-csrf": "1",
        "x-juro-locale": locale,
      },
      body: JSON.stringify(form),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) setError(body.error || copy.saveFailed);
    else {
      setNotice(copy.saveSucceeded);
      if (form.locale !== locale) {
        const localizedBase = base.replace(`/${locale}/`, `/${form.locale}/`);
        window.location.assign(`${localizedBase}/${view === "profile" ? "profile" : "settings"}`);
      }
      else await load();
    }
    setSaving(false);
  }

  async function submitEmailChange(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/platform/security/email-change?lang=${locale}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-csrf": "1",
            "x-juro-locale": locale,
          },
          body: JSON.stringify(emailChange?.active
            ? {
              action: "confirm",
              challengeId: emailChange.active.challengeId,
              currentCode: currentEmailCode,
              newCode: newEmailCode,
              locale,
            }
            : {
              action: "request_codes",
              newEmail,
              locale,
            }),
        },
      );
      const body = await response.json() as {
        code?: string;
        error?: string;
        challengeId?: string;
        currentDestination?: string;
        newDestination?: string;
        expiresInSeconds?: number;
        email?: string;
        revokedSessions?: number;
      };
      if (!response.ok) {
        setError(body.error || copy.emailChangeFailed);
        if ([
          "EMAIL_CHANGE_EXPIRED",
          "EMAIL_CHANGE_REPLACED",
          "EMAIL_CHANGE_ATTEMPTS_EXCEEDED",
          "EMAIL_CHANGE_ADDRESS_UNAVAILABLE",
          "EMAIL_CHANGE_STATE_CHANGED",
        ].includes(body.code ?? "")) {
          await load();
        }
      } else if (
        body.challengeId
        && body.currentDestination
        && body.newDestination
        && body.expiresInSeconds
      ) {
        setEmailChange(previous => ({
          available: previous?.available ?? true,
          canManage: true,
          reason: null,
          currentEmail: previous?.currentEmail ?? data?.profile.email,
          active: {
            challengeId: body.challengeId!,
            currentDestination: body.currentDestination!,
            newDestination: body.newDestination!,
            expiresAt: new Date(
              Date.now() + body.expiresInSeconds! * 1_000,
            ).toISOString(),
          },
        }));
        setCurrentEmailCode("");
        setNewEmailCode("");
        setNotice(copy.emailChangeCodesAccepted);
      } else if (body.email) {
        setNewEmail("");
        setCurrentEmailCode("");
        setNewEmailCode("");
        setNotice(localizedMessage(locale, {
          ru: `Email изменён. Завершено других сессий: ${body.revokedSessions ?? 0}.`,
          uz: `Email o‘zgartirildi. Boshqa yakunlangan sessiyalar: ${body.revokedSessions ?? 0}.`,
          en: `Your email address has been changed. Other sessions ended: ${body.revokedSessions ?? 0}.`,
        }));
        await load();
      }
    } catch {
      setError(copy.networkFailed);
    } finally {
      setSaving(false);
    }
  }

  async function cancelEmailChange() {
    if (!emailChange?.active) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/platform/security/email-change?lang=${locale}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-csrf": "1",
            "x-juro-locale": locale,
          },
          body: JSON.stringify({
            action: "cancel",
            challengeId: emailChange.active.challengeId,
            locale,
          }),
        },
      );
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(body.error || copy.emailChangeCancelFailed);
      }
      setEmailChange(previous => previous
        ? { ...previous, active: null }
        : previous);
      setNewEmail("");
      setCurrentEmailCode("");
      setNewEmailCode("");
      setNotice(copy.emailChangeCanceled);
    } catch (value) {
      setError(value instanceof Error
        ? value.message
        : copy.emailChangeCancelFailed);
    } finally {
      setSaving(false);
    }
  }

  async function closeAllSessions() {
    if (!window.confirm(copy.allSessionsConfirmation)) return;
    if (sessionActionPending.current || loggingOut) return;
    sessionActionPending.current = true;
    setSessionAction("all");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/platform/security/sessions?scope=all&lang=${locale}`,
        {
          method: "DELETE",
          headers: { "x-juro-csrf": "1", "x-juro-locale": locale },
        },
      );
      if (!response.ok) {
        const body = await response.json() as { error?: string };
        throw new Error(body.error || copy.sessionsCloseFailed);
      }
      await finishLogout();
    } catch (value) {
      setError(value instanceof Error ? value.message : copy.sessionsCloseFailed);
    } finally {
      sessionActionPending.current = false;
      setSessionAction(null);
    }
  }

  async function closeOtherSessions() {
    if (sessionActionPending.current || loggingOut) return;
    sessionActionPending.current = true;
    setSessionAction("others");
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/platform/security/sessions?scope=others&lang=${locale}`,
        {
          method: "DELETE",
          headers: { "x-juro-csrf": "1", "x-juro-locale": locale },
        },
      );
      const body = await response.json() as { error?: string; revoked?: number };
      if (!response.ok) {
        throw new Error(body.error || copy.otherSessionsCloseFailed);
      }
      setNotice(localizedMessage(locale, {
        ru: `Завершено сессий: ${body.revoked ?? 0}.`,
        uz: `Yakunlangan sessiyalar: ${body.revoked ?? 0}.`,
        en: `Sessions ended: ${body.revoked ?? 0}.`,
      }));
      await load();
    } catch (value) {
      setError(value instanceof Error
        ? value.message
        : copy.otherSessionsCloseFailed);
    } finally {
      sessionActionPending.current = false;
      setSessionAction(null);
    }
  }

  async function closeSession(session: Session) {
    if (!window.confirm(session.isCurrent
      ? copy.currentSessionConfirmation
      : localizedMessage(locale, {
          ru: `Завершить сессию «${session.deviceName || copy.unknownDevice}»?`,
          uz: `“${session.deviceName || copy.unknownDevice}” sessiyasini yakunlaysizmi?`,
          en: `End the “${session.deviceName || copy.unknownDevice}” session?`,
        }))) return;
    if (sessionActionPending.current || loggingOut) return;
    sessionActionPending.current = true;
    setSessionAction(session.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/platform/security/sessions/${encodeURIComponent(session.id)}?lang=${locale}`, {
        method: "DELETE",
        headers: { "x-juro-csrf": "1", "x-juro-locale": locale },
      });
      const body = await response.json() as { error?: string; revokedCurrent?: boolean };
      if (!response.ok) {
        throw new Error(body.error || copy.sessionCloseFailed);
      }
      if (body.revokedCurrent) {
        await finishLogout();
        return;
      }
      setNotice(copy.sessionClosed);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : copy.sessionCloseFailed);
    } finally {
      sessionActionPending.current = false;
      setSessionAction(null);
    }
  }

  async function startMfaSetup() {
    setSaving(true);
    setError("");
    setNotice("");
    setBackupCodes([]);
    try {
      const response = await fetch(
        `/api/platform/security/mfa/setup?lang=${locale}`,
        {
          method: "POST",
          headers: { "x-juro-csrf": "1", "x-juro-locale": locale },
        },
      );
      const body = await response.json() as MfaSetup & { error?: string };
      if (!response.ok || !body.credentialId) {
        throw new Error(body.error || copy.mfaSetupFailed);
      }
      setMfaSetup(body);
      setMfaCode("");
    } catch (value) {
      setError(value instanceof Error
        ? value.message
        : copy.mfaSetupFailed);
    } finally {
      setSaving(false);
    }
  }

  async function confirmMfaSetup() {
    if (!mfaSetup) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/platform/security/mfa/confirm?lang=${locale}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-juro-csrf": "1",
          "x-juro-locale": locale,
        },
        body: JSON.stringify({
          credentialId: mfaSetup.credentialId,
          code: mfaCode,
          locale,
        }),
      });
      const body = await response.json() as {
        backupCodes?: string[];
        error?: string;
      };
      if (!response.ok || !body.backupCodes?.length) {
        throw new Error(body.error || copy.mfaEnableFailed);
      }
      setBackupCodes(body.backupCodes);
      setMfaSetup(null);
      setMfaCode("");
      setNotice(copy.mfaEnabledNotice);
      await load();
    } catch (value) {
      setError(value instanceof Error
        ? value.message
        : copy.mfaEnableFailed);
    } finally {
      setSaving(false);
    }
  }

  async function manageMfa(action: "disable" | "regenerate") {
    if (!mfaCode.trim()) return;
    if (action === "disable" && !window.confirm(copy.mfaDisableConfirmation)) return;
    setSaving(true);
    setError("");
    setNotice("");
    if (action === "regenerate") setBackupCodes([]);
    try {
      const response = await fetch(
        action === "disable"
          ? `/api/platform/security/mfa?lang=${locale}`
          : `/api/platform/security/mfa/backup-codes?lang=${locale}`,
        {
          method: action === "disable" ? "DELETE" : "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-csrf": "1",
            "x-juro-locale": locale,
          },
          body: JSON.stringify({ code: mfaCode, locale }),
        },
      );
      const body = await response.json() as {
        backupCodes?: string[];
        error?: string;
      };
      if (!response.ok || (action === "regenerate" && !body.backupCodes?.length)) {
        throw new Error(body.error || copy.operationFailed);
      }
      setMfaCode("");
      if (action === "regenerate" && body.backupCodes?.length) {
        setBackupCodes(body.backupCodes);
        setNotice(copy.backupCodesRegenerated);
      } else {
        setBackupCodes([]);
        setNotice(copy.mfaDisabled);
      }
      await load();
    } catch (value) {
      setError(value instanceof Error
        ? value.message
        : copy.operationFailed);
    } finally {
      setSaving(false);
    }
  }

  async function copyBackupCodes() {
    setError("");
    try {
      await navigator.clipboard.writeText(backupCodes.join("\n"));
      setNotice(copy.backupCodesCopied);
    } catch {
      setError(copy.backupCodesCopyFailed);
    }
  }

  async function requestDeletion(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/platform/privacy/deletion-request?lang=${locale}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-csrf": "1",
            "x-juro-locale": locale,
          },
          body: JSON.stringify(deletionChallenge
            ? {
              action: "confirm",
              challengeId: deletionChallenge.challengeId,
              code: deletionCode,
              confirmation: deleteConfirmation,
              deletionMode,
              locale,
            }
            : { action: "request_code", locale }),
        },
      );
      const body = await response.json() as {
        error?: string;
        challengeId?: string;
        destination?: string;
        expiresInSeconds?: number;
        logout?: boolean;
      };
      if (!response.ok) {
        setError(body.error || copy.deletionRequestFailed);
      } else if (body.logout) {
        setNotice(deletionMode === "recoverable_30d"
          ? copy.deletionRecoverableQueued
          : copy.deletionImmediateQueued);
        await finishLogout();
      } else if (
        body.challengeId
        && body.destination
        && body.expiresInSeconds
      ) {
        setDeletionChallenge({
          challengeId: body.challengeId,
          destination: body.destination,
          expiresInSeconds: body.expiresInSeconds,
        });
        setNotice(localizedMessage(locale, {
          ru: `Код отправлен на ${body.destination}.`,
          uz: `Kod ${body.destination} manziliga yuborildi.`,
          en: `A code was sent to ${body.destination}.`,
        }));
      }
    } catch {
      setError(copy.networkFailed);
    } finally {
      setSaving(false);
    }
  }

  async function cancelDeletionRequest() {
    if (!data?.deletionRequest?.cancelable) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/platform/privacy/deletion-request?lang=${locale}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-csrf": "1",
            "x-juro-locale": locale,
          },
          body: JSON.stringify({
            action: "cancel",
            requestId: data.deletionRequest.id,
            locale,
          }),
        },
      );
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(body.error || copy.deletionCancelFailed);
      }
      setNotice(copy.deletionCanceled);
      await load();
    } catch (value) {
      setError(value instanceof Error
        ? value.message
        : copy.deletionCancelFailed);
    } finally {
      setSaving(false);
    }
  }
  async function retryDeletionRequest() {
    if (!data?.deletionRequest?.retryable) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/platform/privacy/deletion-request?lang=${locale}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-csrf": "1",
            "x-juro-locale": locale,
          },
          body: JSON.stringify({
            action: "retry",
            requestId: data.deletionRequest.id,
            locale,
          }),
        },
      );
      const body = await response.json() as {
        error?: string;
        logout?: boolean;
      };
      if (!response.ok) {
        throw new Error(body.error || copy.deletionRetryFailed);
      }
      setNotice(copy.deletionRetryQueued);
      if (body.logout) {
        await finishLogout();
      } else {
        await load();
      }
    } catch (value) {
      setError(value instanceof Error
        ? value.message
        : copy.deletionRetryFailed);
    } finally {
      setSaving(false);
    }
  }
  async function createBusinessWorkspace(event: FormEvent) {
    event.preventDefault();
    if (creatingWorkspace) return;
    setCreatingWorkspace(true);
    setError("");
    setNotice("");
    const requestId = businessWorkspace.requestId || crypto.randomUUID();
    if (!businessWorkspace.requestId) {
      setBusinessWorkspace(current => ({ ...current, requestId }));
    }
    try {
      const response = await fetch(`/api/platform/workspaces?lang=${locale}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-juro-csrf": "1",
          "x-juro-locale": locale,
        },
        body: JSON.stringify({
          action: "create",
          requestId,
          fullName: businessWorkspace.fullName,
          shortName: businessWorkspace.shortName,
          locale,
        }),
      });
      const body = await response.json() as { redirectTo?: string; error?: string };
      if (!response.ok || !body.redirectTo) {
        throw new Error(body.error || copy.workspaceCreateFailed);
      }
      window.location.assign(body.redirectTo);
    } catch (value) {
      setError(value instanceof Error ? value.message : copy.workspaceCreateFailed);
      setCreatingWorkspace(false);
    }
  }
  if (loading) return <div className="profile-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" /><span className="sr-only">{copy.loadingSettings}</span></div>;
  const title = view === "profile"
    ? copy.profileTitle
    : view === "security"
      ? copy.securityTitle
      : view === "privacy"
        ? copy.privacyTitle
        : copy.settingsTitle;
  const Icon = view === "profile" ? UserRound : view === "security" ? ShieldCheck : view === "privacy" ? Database : Languages;
  return <section className="profile-workspace"><header><Icon /><div><small>JURO</small><h1>{title}</h1><p>{copy.headerDescription}</p></div></header><nav aria-label={copy.accountSettings}><Link className={view === "profile" ? "active" : ""} href={`${base}/profile`}>{copy.profileNav}</Link><Link className={view === "settings" ? "active" : ""} href={`${base}/settings`}>{copy.settingsNav}</Link><Link className={view === "security" ? "active" : ""} href={`${base}/settings/security`}>{copy.securityNav}</Link><Link className={view === "privacy" ? "active" : ""} href={`${base}/settings/privacy`}>{copy.privacyNav}</Link></nav>{error && <p className="profile-message error" role="alert"><CircleAlert aria-hidden="true" />{error}</p>}{view === "security" && error && !mfa && <button className="profile-retry" type="button" disabled={retrying} aria-busy={retrying} onClick={() => void retryLoad()}>{retrying && <LoaderCircle className="spin" aria-hidden="true" />}{copy.retryLoad}</button>}{notice && <p className="profile-message success" role="status"><ShieldCheck aria-hidden="true" />{notice}</p>}
    {(view === "profile" || view === "settings") && data && <form className="profile-form" onSubmit={save}><section><h2>{copy.basicData}</h2><label>{copy.name}<input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label><label>Email<input disabled value={data.profile.email} /><small>{copy.emailChangeHint}</small></label><label>{copy.phone}<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} autoComplete="tel" /></label></section><section><h2>{copy.workspace}</h2><label>{copy.language}<Select value={form.locale} onChange={(event) => { if (isLocale(event.target.value)) setForm({ ...form, locale: event.target.value }); }}><option value="ru">Русский</option><option value="uz">O‘zbekcha</option><option value="en">English</option></Select></label><label>{copy.timezone}<Select value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })}><option value="Asia/Tashkent">Asia/Tashkent</option><option value="UTC">UTC</option></Select></label>{accountType === "business" && <><label>{copy.organization}<input value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} /></label><label>{copy.organizationRole}<input value={form.organizationRole} onChange={(event) => setForm({ ...form, organizationRole: event.target.value })} /></label></>}</section><button disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Save />}{copy.saveChanges}</button></form>}
    {["lawyer","business"].includes(accountType) && (view === "profile" || view === "settings") && <LawyerProfessionalProfile locale={locale} />}
    {view === "settings" && <NotificationPreferencesPanel locale={locale} />}
    {view === "settings" && <section className="business-workspace-panel" id="business-workspace">
      <div className="business-workspace-heading"><Building2 aria-hidden="true" /><div><h2>{copy.newBusinessWorkspace}</h2><p id="business-workspace-description">{copy.businessWorkspaceDescription}</p></div></div>
      <form onSubmit={createBusinessWorkspace} aria-describedby="business-workspace-description">
        <label>{copy.fullNameLabel}<input required minLength={2} maxLength={200} autoComplete="organization" value={businessWorkspace.fullName} onChange={(event) => setBusinessWorkspace(current => ({ ...current, fullName: event.target.value }))} /></label>
        <label>{copy.shortNameLabel}<input required minLength={2} maxLength={80} value={businessWorkspace.shortName} onChange={(event) => setBusinessWorkspace(current => ({ ...current, shortName: event.target.value }))} /></label>
        <button type="submit" disabled={creatingWorkspace || businessWorkspace.fullName.trim().length < 2 || businessWorkspace.shortName.trim().length < 2} aria-busy={creatingWorkspace}>{creatingWorkspace ? <LoaderCircle className="spin" aria-hidden="true" /> : <Building2 aria-hidden="true" />}{copy.createAndOpen}</button>
      </form>
    </section>}    {(view === "profile" || view === "settings") && data && emailChange && <section className="email-change-panel">
      <h2><MailCheck aria-hidden="true" />{copy.secureEmailChange}</h2>
      <p id="email-change-description">{copy.emailChangeDescription}</p>
      {!emailChange.canManage && <p>{copy.emailChangeLocalOnly}</p>}
      {emailChange.canManage && !emailChange.available && !emailChange.active && <p>{copy.emailChangeUnavailable}</p>}
      {emailChange.canManage && emailChange.available && !emailChange.active && <form onSubmit={submitEmailChange}>
        <label>{copy.newEmail}
          <input
            type="email"
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value.slice(0, 254))}
            autoComplete="email"
            maxLength={254}
            aria-describedby="email-change-description"
            required
          />
        </label>
        <button type="submit" disabled={saving || newEmail.trim().length < 3} aria-busy={saving}>
          {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <MailCheck aria-hidden="true" />}
          {copy.sendTwoCodes}
        </button>
      </form>}
      {emailChange.canManage && emailChange.active && <div
        ref={emailChangeRegion}
        className="email-change-verification"
        role="region"
        tabIndex={-1}
        aria-label={copy.emailChangeVerification}
        aria-describedby="email-change-description"
      >
        <p role="status">{localizedMessage(locale, {
          ru: `Почтовый сервис принял письма для ${emailChange.active.currentDestination} и ${emailChange.active.newDestination}. Коды действуют до ${formatPlatformDateTime(emailChange.active.expiresAt, locale)}.`,
          uz: `Pochta xizmati ${emailChange.active.currentDestination} va ${emailChange.active.newDestination} uchun xatlarni qabul qildi. Kodlar ${formatPlatformDateTime(emailChange.active.expiresAt, locale)} gacha amal qiladi.`,
          en: `The email service accepted messages for ${emailChange.active.currentDestination} and ${emailChange.active.newDestination}. The codes are valid until ${formatPlatformDateTime(emailChange.active.expiresAt, locale)}.`,
        })}</p>
        <form onSubmit={submitEmailChange}>
          <label>{copy.currentEmailCode}
            <input
              value={currentEmailCode}
              onChange={(event) => setCurrentEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <label>{copy.newEmailCode}
            <input
              value={newEmailCode}
              onChange={(event) => setNewEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <div className="email-change-actions">
            <button
              type="submit"
              disabled={saving || currentEmailCode.length !== 6 || newEmailCode.length !== 6}
              aria-busy={saving}
            >
              {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              {copy.verifyAndChange}
            </button>
            <button
              className="danger-outline"
              type="button"
              disabled={saving}
              onClick={() => void cancelEmailChange()}
            >
              {copy.cancel}
            </button>
          </div>
        </form>
      </div>}
    </section>}
    {view === "security" && <div className="profile-panels">
      <section>
        <h2><MonitorSmartphone />{copy.sessionsTitle}</h2>
        <p>{copy.sessionsDescription}</p>
        {sessions.length
          ? sessions.map(session => <div className="session-row" key={session.id}>
            <span>
              <strong>{session.deviceName || copy.unknownDevice}{Boolean(session.isCurrent) && <em>{copy.current}</em>}</strong>
              <small>{copy.lastActivity}: {formatPlatformDateTime(session.lastSeenAt, locale)}</small>
              <small>{copy.signIn}: {formatPlatformDateTime(session.authenticatedAt || session.createdAt, locale)} · {session.authMethod === "email_otp" ? "Email OTP" : session.authMethod}</small>
              <small>{copy.approximateRegion}: {[session.regionCode, session.countryCode].filter(Boolean).join(", ") || copy.regionUnknown}</small>
            </span>
            <div className="session-actions">
              <time>{copy.until} {formatPlatformDateTime(session.idleExpiresAt || session.expiresAt, locale)}</time>
              <button type="button" disabled={loggingOut || sessionAction !== null} aria-busy={sessionAction === session.id || (loggingOut && Boolean(session.isCurrent))} onClick={() => void closeSession(session)} aria-label={localizedMessage(locale, {
                ru: `Завершить сессию ${session.deviceName || copy.unknownDevice}`,
                uz: `${session.deviceName || copy.unknownDevice} sessiyasini yakunlash`,
                en: `End the ${session.deviceName || copy.unknownDevice} session`,
              })}>{sessionAction === session.id || (loggingOut && Boolean(session.isCurrent)) ? <LoaderCircle className="spin" aria-hidden="true" /> : <LogOut />}{copy.endSession}</button>
            </div>
          </div>)
          : <p>{copy.noSessions}</p>}
        <div className="session-bulk-actions">
          {sessions.some(session => !Boolean(session.isCurrent)) && <button className="danger-outline" type="button" disabled={loggingOut || sessionAction !== null} aria-busy={sessionAction === "others"} onClick={() => void closeOtherSessions()}>{sessionAction === "others" && <LoaderCircle className="spin" aria-hidden="true" />}{copy.endOtherSessions}</button>}
          <button className="danger-outline" type="button" disabled={loggingOut || sessionAction !== null} aria-busy={loggingOut || sessionAction === "all"} onClick={() => void closeAllSessions()}>{(loggingOut || sessionAction === "all") && <LoaderCircle className="spin" aria-hidden="true" />}{copy.endAllSessions}</button>
        </div>
      </section>
      <section className="mfa-panel">
        <h2><KeyRound aria-hidden="true" />{copy.twoFactor}</h2>
        {mfa && !mfa.canManage && <p>{copy.mfaLocalOnly}</p>}
        {mfa?.canManage && !mfa.available && <p>{copy.mfaUnavailable}</p>}
        {mfa?.available && !mfa.enabled && !mfaSetup && <div className="mfa-state">
          <span>{copy.mfaOff}</span>
          <p>{copy.mfaOffDescription}</p>
          <button type="button" disabled={saving} aria-busy={saving} onClick={() => void startMfaSetup()}>
            {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
            {copy.enableMfa}
          </button>
        </div>}
        {mfaSetup && <div
          ref={mfaSetupRegion}
          className="mfa-setup"
          role="region"
          tabIndex={-1}
          aria-label={copy.mfaSetup}
          aria-describedby="mfa-setup-description"
        >
          <p id="mfa-setup-description">{copy.mfaSetupDescription}</p>
          <a href={mfaSetup.otpauthUri}>{copy.openAuthenticator}</a>
          <code>{mfaSetup.secret}</code>
          <small>{copy.setupValidUntil}: {formatPlatformDateTime(mfaSetup.expiresAt, locale)}</small>
          <label>{copy.appCode}
            <input value={mfaCode} onChange={(event) => setMfaCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} aria-describedby="mfa-setup-description" />
          </label>
          <div className="mfa-actions">
            <button type="button" disabled={saving || mfaCode.length !== 6} aria-busy={saving} onClick={() => void confirmMfaSetup()}>
              {saving ? <LoaderCircle className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
              {copy.confirmAndEnable}
            </button>
            <button className="danger-outline" type="button" disabled={saving} onClick={() => { setMfaSetup(null); setMfaCode(""); }}>
              {copy.cancel}
            </button>
          </div>
        </div>}
        {mfa?.enabled && <div className="mfa-state">
          <span className="mfa-enabled"><ShieldCheck aria-hidden="true" />{copy.mfaOn}</span>
          <p id="mfa-manage-description">{localizedMessage(locale, {
            ru: `Неиспользованных резервных кодов: ${mfa.backupCodesRemaining}. Для изменения введите свежий TOTP или резервный код.`,
            uz: `Ishlatilmagan zaxira kodlar: ${mfa.backupCodesRemaining}. O‘zgartirish uchun yangi TOTP yoki zaxira kodni kiriting.`,
            en: `Unused backup codes: ${mfa.backupCodesRemaining}. Enter a current TOTP or backup code to make a change.`,
          })}</p>
          <label>{copy.verificationCode}
            <input value={mfaCode} onChange={(event) => setMfaCode(event.target.value.toUpperCase().replace(/[^A-Z0-9 -]/g, "").slice(0, 64))} autoComplete="one-time-code" maxLength={64} aria-describedby="mfa-manage-description" />
          </label>
          <div className="mfa-actions">
            <button type="button" disabled={saving || mfaCode.trim().length < 6} aria-busy={saving} onClick={() => void manageMfa("regenerate")}>
              <RefreshCcw aria-hidden="true" />{copy.newBackupCodes}
            </button>
            <button className="danger-outline" type="button" disabled={saving || mfaCode.trim().length < 6} aria-busy={saving} onClick={() => void manageMfa("disable")}>
              {copy.disableMfa}
            </button>
          </div>
        </div>}
        {backupCodes.length > 0 && <div
          ref={backupCodesRegion}
          className="backup-codes"
          role="region"
          tabIndex={-1}
          aria-label={copy.newBackupCodes}
          aria-describedby="backup-codes-description"
        >
          <strong>{copy.saveCodesNow}</strong>
          <p id="backup-codes-description">{copy.backupCodesDescription}</p>
          <div>{backupCodes.map(code => <code key={code}>{code}</code>)}</div>
          <button type="button" onClick={() => void copyBackupCodes()}><Copy aria-hidden="true" />{copy.copyCodes}</button>
        </div>}
      </section>
      <section>
        <h2><ShieldCheck />{copy.securityMechanisms}</h2>
        <ul>
          <li>{copy.cookieSecurity}</li>
          <li>{copy.sessionLifetime}</li>
          <li>{copy.totpSecurity}</li>
          <li>{copy.auditSecurity}</li>
        </ul>
      </section>
    </div>}
    {view === "privacy" && <MemoryPanel locale={locale} />}
    {view === "privacy" && data && <div className="profile-panels">
      <section>
        <h2><Download />{copy.dataExport}</h2>
        <p>{copy.exportDescription}</p>
        <Link className="profile-download" href={`/api/platform/privacy/export?lang=${locale}`} prefetch={false}>
          <Download />{copy.downloadExport}
        </Link>
      </section>
      <section>
        <h2>{copy.consentHistory}</h2>
        {data.acceptances.map(acceptance => <div className="consent-row" key={`${acceptance.type}-${acceptance.version}`}>
          <strong>{acceptance.type}</strong>
          <span>
            v{acceptance.version} · {acceptance.locale || "—"} · {acceptance.status}
          </span>
          <time>{formatPlatformDateTime(acceptance.acceptedAt, locale)}</time>
        </div>)}
        {data.consents.map(consent => <div className="consent-row" key={`${consent.type}-${consent.grantedAt}`}>
          <strong>{consent.type}</strong>
          <span>v{consent.version}</span>
          <time>{formatPlatformDateTime(consent.grantedAt, locale)}</time>
        </div>)}
        {!data.acceptances.length && !data.consents.length && <p>
          {copy.noRecords}
        </p>}
      </section>
      {data.deletionRequest
        ? <section className="deletion-request-status" aria-live="polite">
          <h2><Trash2 aria-hidden="true" />{copy.deleteAccount}</h2>
          <p>{data.deletionRequest.status === "blocked"
            ? copy.deletionBlockedDescription
            : data.deletionRequest.deletionMode === "recoverable_30d"
              ? copy.deletionRecoverableDescription
              : copy.deletionImmediateDescription}</p>
          <div className="consent-row">
            <strong>{data.deletionRequest.status}</strong>
            <span>{data.deletionRequest.deletionMode === "recoverable_30d"
              ? copy.recoveryPeriod
              : copy.noRecoveryPeriod}</span>
            <time>{formatPlatformDateTime(
              data.deletionRequest.scheduledPurgeAt || data.deletionRequest.requestedAt,
              locale,
            )}</time>
          </div>
          {Boolean(data.deletionRequest.cancelable) && <button
            className="danger-outline"
            type="button"
            disabled={saving}
            aria-busy={saving}
            onClick={cancelDeletionRequest}
          >
            {saving && <LoaderCircle className="spin" aria-hidden="true" />}
            {copy.cancelDeletion}
          </button>}
          {Boolean(data.deletionRequest.retryable) && <button
            className="danger-outline"
            type="button"
            disabled={saving}
            aria-busy={saving}
            onClick={retryDeletionRequest}
          >
            {saving && <LoaderCircle className="spin" aria-hidden="true" />}
            {copy.retryDeletion}
          </button>}
        </section>
        : <form className="delete-request" onSubmit={requestDeletion}>
        <Trash2 />
        <div>
          <h2>{copy.requestDeletion}</h2>
          <p id="deletion-request-description">{copy.requestDeletionDescription}</p>
          <fieldset className="deletion-mode-options" disabled={Boolean(deletionChallenge) || saving}>
            <legend>{copy.whenDelete}</legend>
            <label>
              <input
                type="radio"
                name="deletion-mode"
                value="recoverable_30d"
                checked={deletionMode === "recoverable_30d"}
                onChange={() => setDeletionMode("recoverable_30d")}
              />
              <span><strong>{copy.afterThirtyDays}</strong>{copy.afterThirtyDaysDescription}</span>
            </label>
            <label>
              <input
                type="radio"
                name="deletion-mode"
                value="immediate"
                checked={deletionMode === "immediate"}
                onChange={() => setDeletionMode("immediate")}
              />
              <span><strong>{copy.immediately}</strong>{copy.immediatelyDescription}</span>
            </label>
          </fieldset>
          {!deletionChallenge
            ? <button type="submit" disabled={saving} aria-busy={saving}>
              {saving && <LoaderCircle className="spin" aria-hidden="true" />}
              {copy.getEmailCode}
            </button>
            : <>
              <p className="deletion-code-destination" role="status">{localizedMessage(locale, {
                ru: `Код отправлен на ${deletionChallenge.destination} и действует ${Math.floor(deletionChallenge.expiresInSeconds / 60)} минут.`,
                uz: `Kod ${deletionChallenge.destination} manziliga yuborildi va ${Math.floor(deletionChallenge.expiresInSeconds / 60)} daqiqa amal qiladi.`,
                en: `A code was sent to ${deletionChallenge.destination} and is valid for ${Math.floor(deletionChallenge.expiresInSeconds / 60)} minutes.`,
              })}</p>
              <label>{copy.emailCode}
                <input
                  value={deletionCode}
                  onChange={(event) => setDeletionCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  aria-describedby="deletion-request-description"
                  required
                />
              </label>
              <label>{copy.controlConfirmation}
                <input
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                  required
                />
              </label>
              <div className="deletion-actions">
                <button
                  type="submit"
                  disabled={saving || deletionCode.length !== 6 || deleteConfirmation !== "DELETE"}
                  aria-busy={saving}
                >
                  {saving && <LoaderCircle className="spin" aria-hidden="true" />}
                  {copy.confirmRequest}
                </button>
                <button
                  className="danger-outline"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setDeletionChallenge(null);
                    setDeletionCode("");
                    setDeleteConfirmation("");
                  }}
                >
                  {copy.cancel}
                </button>
              </div>
            </>}
        </div>
        </form>}
    </div>}
  </section>;
}
