"use client";

import { Select } from "../../_components/Select";

import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { Plus, Trash2, UserRoundCheck, UsersRound } from "lucide-react";
import { newScheduleItem, newWitness } from "../../../lib/document-builder/defaults";
import { parseAmount } from "../../../lib/document-builder/money-to-words";
import type {
  ContactRecord,
  PartyDetails,
  ReceiptAnswers,
  TransferMethod,
  UserProfile,
} from "../../../lib/document-builder/types";
import { BuilderFormLocaleProvider, ChoiceGroup, FormSection, InputField, SelectField, TextAreaField, Toggle } from "./FormControls";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderIntlLocale } from "../builder-localization";

export const BUILDER_STEPS = [
  "Основные данные",
  "Условия займа",
  "Передача и возврат денежных средств",
  "Дополнительные условия",
  "Проверка и создание",
] as const;

const BUILDER_STEPS_EN = [
  "Basic details",
  "Loan terms",
  "Transfer and repayment",
  "Additional terms",
  "Review and create",
] as const;

export function builderSteps(locale: PlatformLocale): readonly string[] {
  return locale === "en" ? BUILDER_STEPS_EN : BUILDER_STEPS;
}

const EN_QUESTIONNAIRE_TEXT: Readonly<Record<string, string>> = {
  "Основные данные": "Basic details",
  "Условия займа": "Loan terms",
  "Передача и возврат денежных средств": "Transfer and repayment",
  "Дополнительные условия": "Additional terms",
  "Проверка и создание": "Review and create",
  "Можно продолжить и при неполных данных — JURO покажет предупреждение.": "You can continue with incomplete details; JURO will flag anything that needs attention.",
  "Данные профиля": "Use profile details",
  "Сохраняем…": "Saving…",
  "Сохранить в профиль": "Save to profile",
  "Выбрать контакт": "Choose a contact",
  "Изменения здесь не меняют сохранённый контакт автоматически.": "Changes here do not automatically update the saved contact.",
  "Выбрать, где применить изменения": "Choose where to apply changes",
  "Применение изменений контакта": "Apply contact changes",
  "Обновить только текущий документ": "Update this document only",
  "Применять новые данные только к будущим документам": "Use the new details only for future documents",
  "Оставить текущий документ без изменений": "Keep this document unchanged",
  "Ф.И.О.": "Full name",
  "Укажите имя так, как оно написано в документе, удостоверяющем личность.": "Enter the name exactly as shown on the identity document.",
  "Каримов Азиз Акмалович": "Aziz Akmalovich Karimov",
  "Дата рождения": "Date of birth",
  "Можно выбрать дату в календаре либо ввести её вручную.": "Choose a date from the calendar or enter it manually.",
  "Тип документа": "Identity document",
  "Не выбран": "Not selected",
  "Паспорт": "Passport",
  "ID-карта": "ID card",
  "Номер документа": "Document number",
  "Серия и номер вводятся одним текстовым значением. Формат не ограничивается.": "Enter the series and number in one field. Any document format is accepted.",
  "Кем выдан": "Issued by",
  "Дата выдачи": "Issue date",
  "ПИНФЛ": "PINFL",
  "Введите ровно 14 цифр. JURO не сверяет ПИНФЛ по государственным базам.": "Enter exactly 14 digits. JURO does not verify PINFL against government databases.",
  "Номер телефона": "Phone number",
  "Вводится вручную без автоматического форматирования.": "Enter the number manually; it will not be reformatted.",
  "Email — необязательно": "Email — optional",
  "Email не проходит блокирующую форматную проверку.": "An email format warning will not block document creation.",
  "Адрес регистрации": "Registered address",
  "Дата": "Date",
  "Место": "Place",
  "При передаче присутствовали свидетели": "Witnesses were present during the transfer",
  "Дополнительный комментарий": "Additional note",
  "Наименование банка": "Bank name",
  "Номер счёта или последние цифры": "Account number or final digits",
  "Дата перевода": "Transfer date",
  "Номер или назначение платежа": "Payment reference or purpose",
  "Квитанция / подтверждающий документ": "Receipt or supporting document",
  "Последние 4 цифры карты отправителя": "Sender card — last 4 digits",
  "Последние 4 цифры карты получателя": "Recipient card — last 4 digits",
  "Время перевода": "Transfer time",
  "Сумма перевода": "Transfer amount",
  "Номер транзакции": "Transaction number",
  "Квитанция или скриншот": "Receipt or screenshot",
  "Наименование способа": "Method name",
  "Место или канал": "Place or channel",
  "Реквизиты / подтверждение": "Details or evidence",
  "Присутствовали свидетели": "Witnesses were present",
  "Свободные сведения о способе возврата": "Other repayment method details",
  "Кто участвует в создании документа?": "Who is involved in creating this document?",
  "Роль запрашивается отдельно для каждой новой расписки.": "Choose your role separately for each new receipt.",
  "Ваша роль": "Your role",
  "Я являюсь одной из сторон": "I am one of the parties",
  "Создаю расписку для себя": "I am creating the receipt for myself",
  "Я создаю документ за другого человека": "I am creating this document for someone else",
  "Заполняю сведения по поручению стороны": "I am entering details on a party’s behalf",
  "Я представляю организацию/компанию": "I represent an organisation or company",
  "Продолжить с шаблоном для физических лиц": "Continue with the individual-person template",
  "Кем вы являетесь?": "Which party are you?",
  "Я займодавец": "I am the lender",
  "Я заемщик": "I am the borrower",
  "За кого создаётся документ?": "Who are you creating the document for?",
  "За займодавца": "For the lender",
  "За заемщика": "For the borrower",
  "За обе стороны": "For both parties",
  "Данный шаблон предназначен преимущественно для физических лиц. Для организаций рекомендуется использовать специализированные шаблоны документов.": "This template is intended primarily for individuals. Organisations should use a dedicated business template.",
  "Место и дата составления": "Place and date",
  "Место составления": "Place of signing",
  "Укажите населённый пункт, где стороны подпишут расписку.": "Enter the city or town where the parties will sign the receipt.",
  "г. Ташкент": "Tashkent",
  "Дата составления": "Signing date",
  "Стороны": "Parties",
  "Займодавец": "Lender",
  "Заемщик": "Borrower",
  "Сумма и срок займа": "Loan amount and term",
  "Дата фактической передачи денег": "Date funds are transferred",
  "Срок возврата": "Repayment deadline",
  "Сумма цифрами": "Amount in figures",
  "Допустимы цифры, пробелы, точка или запятая для центов.": "Use digits and spaces; a decimal point or comma is accepted for cents.",
  "Валюта": "Currency",
  "Узбекский сум": "Uzbekistani soum",
  "Доллар США": "US dollar",
  "Учитывать доллары и центы": "Include dollars and cents",
  "Сумма прописью": "Amount in words",
  "JURO формирует значение автоматически. Вы можете исправить его вручную; AI-проверка сравнит обе суммы.": "JURO generates this value automatically. You can edit it; the AI review will compare both amounts.",
  "Проценты за пользование займом": "Interest",
  "Режим займа": "Interest arrangement",
  "Беспроцентный займ": "Interest-free loan",
  "Процентный займ": "Interest-bearing loan",
  "Иной порядок": "Other arrangement",
  "Процентная ставка, %": "Interest rate, %",
  "Период начисления": "Accrual period",
  "Месяц": "Month",
  "Год": "Year",
  "Иной": "Other",
  "Иной период": "Other period",
  "Порядок уплаты": "Payment timing",
  "Вместе с основной суммой": "With the principal",
  "Ежемесячно": "Monthly",
  "По другому графику": "Other schedule",
  "Другой порядок уплаты": "Other payment arrangement",
  "Опишите иной порядок": "Describe the alternative arrangement",
  "Досрочный возврат": "Early repayment",
  "Допускается ли досрочный возврат?": "Is early repayment allowed?",
  "Разрешить": "Allow",
  "Запретить без согласия займодавца": "Require the lender’s consent",
  "Разрешить на определённых условиях": "Allow subject to conditions",
  "Условия досрочного возврата": "Early repayment conditions",
  "Передача денежных средств": "Transfer of funds",
  "Способ передачи": "Transfer method",
  "Наличными": "Cash",
  "Банковским переводом": "Bank transfer",
  "На банковскую карту": "Bank card",
  "Иным способом": "Other method",
  "Возврат займа": "Loan repayment",
  "Порядок возврата": "Repayment plan",
  "Один платёж": "Single payment",
  "Частями по графику": "Instalment schedule",
  "Способ возврата": "Repayment method",
  "График частичных платежей": "Instalment schedule",
  "Добавить платёж": "Add payment",
  "Сумма": "Amount",
  "Способ": "Method",
  "Наличные": "Cash",
  "Банк": "Bank",
  "Карта": "Card",
  "Комментарий": "Note",
  "Итого по графику": "Schedule total",
  "Совпадает с суммой займа": "Matches the loan amount",
  "Ответственность": "Liability",
  "Как оформить раздел?": "How should this section be handled?",
  "Включить стандартный юридический блок": "Include the standard legal wording",
  "Не включать блок": "Exclude this section",
  "Добавить собственные условия": "Add custom terms",
  "Собственные условия ответственности": "Custom liability terms",
  "Уведомления": "Notices",
  "Включить стандартный блок": "Include the standard wording",
  "Не включать": "Exclude",
  "Контакты займодавца для уведомлений": "Lender contact details for notices",
  "Контакты заемщика для уведомлений": "Borrower contact details for notices",
  "Срок уведомления, календарных дней": "Notice period, calendar days",
  "Собственные условия уведомлений": "Custom notice terms",
  "Свидетели": "Witnesses",
  "При подписании будут свидетели": "Witnesses will be present at signing",
  "Свидетель": "Witness",
  "Телефон": "Phone",
  "Строка подписи будет добавлена автоматически.": "A signature line will be added automatically.",
  "Добавить свидетеля": "Add witness",
  "Другие условия сторон": "Other terms agreed by the parties",
  "Добавляйте только условия, согласованные сторонами. Они появятся в заключительных положениях.": "Add only terms agreed by the parties. They will appear in the final provisions.",
  "Проверка перед созданием": "Review before creating",
  "Предупреждения не блокируют формирование документа.": "Warnings do not prevent document generation.",
  "Данные сторон заполнены": "Party details entered",
  "Допускаются неполные данные, но это влияет на оценку.": "Incomplete details are allowed, but they affect the review score.",
  "Сумма указана": "Amount entered",
  "Срок возврата указан": "Repayment deadline entered",
  "Обязательные поля проверены": "Required fields checked",
  "Технически документ можно сформировать и с предупреждениями.": "The document can still be generated when warnings remain.",
  "Я подтверждаю, что введённые данные достоверны, JURO не является стороной расписки, а шаблон не заменяет индивидуальную консультацию юриста.": "I confirm that the information entered is accurate, that JURO is not a party to this receipt, and that the template does not replace individual legal advice.",
};

const TRANSLATABLE_PROPS = new Set(["title", "description", "label", "help", "example", "placeholder", "aria-label"]);

function translateQuestionnaireText(value: string): string {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.trim();
  if (/^Удалить платёж \d+$/.test(core)) return `${leading}${core.replace("Удалить платёж", "Delete payment")}${trailing}`;
  if (/^Удалить свидетеля \d+$/.test(core)) return `${leading}${core.replace("Удалить свидетеля", "Delete witness")}${trailing}`;
  if (core.startsWith("Не совпадает с суммой займа:")) return `${leading}${core.replace("Не совпадает с суммой займа:", "Does not match the loan amount:")}${trailing}`;
  return `${leading}${EN_QUESTIONNAIRE_TEXT[core] ?? core}${trailing}`;
}

function localizeOptions(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((option) => {
    if (!option || typeof option !== "object") return option;
    const current = option as Record<string, unknown>;
    return {
      ...current,
      ...(typeof current.label === "string" ? { label: translateQuestionnaireText(current.label) } : {}),
      ...(typeof current.description === "string" ? { description: translateQuestionnaireText(current.description) } : {}),
    };
  });
}

function localizeQuestionnaireNode(node: ReactNode): ReactNode {
  if (typeof node === "string") return translateQuestionnaireText(node);
  if (!isValidElement<Record<string, unknown>>(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const nextProps: Record<string, unknown> = {};
  for (const key of TRANSLATABLE_PROPS) {
    const value = element.props[key];
    if (typeof value === "string") nextProps[key] = translateQuestionnaireText(value);
  }
  if (element.props.options) nextProps.options = localizeOptions(element.props.options);
  if (element.props.children !== undefined) {
    nextProps.children = Children.map(element.props.children as ReactNode, localizeQuestionnaireNode);
  }
  return cloneElement(element, nextProps);
}

function localizeQuestionnaire(locale: PlatformLocale, node: ReactElement): ReactElement {
  const content = locale === "en" ? localizeQuestionnaireNode(node) as ReactElement : node;
  return <BuilderFormLocaleProvider locale={locale}>{content}</BuilderFormLocaleProvider>;
}

type Props = {
  answers: ReceiptAnswers;
  onChange: (answers: ReceiptAnswers) => void;
  step: number;
  profile: UserProfile | null;
  contacts: ContactRecord[];
  onSaveProfile: (party: PartyDetails) => Promise<void>;
  onUpdateContact: (contactId: string, party: PartyDetails) => Promise<void>;
  locale?: PlatformLocale;
};

function setPath<T extends object>(object: T, path: string, value: unknown): T {
  const copy = structuredClone(object) as Record<string, unknown>;
  const keys = path.split(".");
  let cursor = copy;
  keys.slice(0, -1).forEach((key) => {
    cursor = cursor[key] as Record<string, unknown>;
  });
  cursor[keys[keys.length - 1]] = value;
  return copy as T;
}

function partyFromProfile(profile: UserProfile): PartyDetails {
  return {
    fullName: profile.fullName ?? "",
    birthDate: profile.birthDate ?? "",
    idDocumentType: profile.idDocumentType ?? "",
    idDocumentNumber: profile.idDocumentNumber ?? "",
    idIssuedBy: profile.idIssuedBy ?? "",
    idIssueDate: profile.idIssueDate ?? "",
    pinfl: profile.pinfl ?? "",
    registeredAddress: profile.registeredAddress ?? "",
    phone: profile.phone ?? "",
    email: profile.email,
    noticeDetails: [profile.phone, profile.email].filter(Boolean).join(", "),
  };
}

function partyFromContact(contact: ContactRecord): PartyDetails {
  return {
    fullName: contact.fullName,
    birthDate: contact.birthDate ?? "",
    idDocumentType: contact.idDocumentType ?? "",
    idDocumentNumber: contact.idDocumentNumber ?? "",
    idIssuedBy: contact.idIssuedBy ?? "",
    idIssueDate: contact.idIssueDate ?? "",
    pinfl: contact.pinfl ?? "",
    registeredAddress: contact.registeredAddress ?? "",
    phone: contact.phone ?? "",
    email: "",
    noticeDetails: contact.phone ?? "",
    contactId: contact.id,
  };
}

function PartyForm({ title, side, party, update, contacts, profile, canUseProfile, onSaveProfile, onUpdateContact, locale }: {
  title: string;
  side: "lender" | "borrower";
  party: PartyDetails;
  update: (path: string, value: unknown) => void;
  contacts: ContactRecord[];
  profile: UserProfile | null;
  canUseProfile: boolean;
  onSaveProfile: (party: PartyDetails) => Promise<void>;
  onUpdateContact: (contactId: string, party: PartyDetails) => Promise<void>;
  locale: PlatformLocale;
}) {
  const contactId = party.contactId ?? "";
  const [contactChoice, setContactChoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const originalContact = contacts.find((item) => item.id === contactId);
  return localizeQuestionnaire(locale, <div className="dbt-party-block">
    <div className="dbt-party-heading"><div><h3>{title}</h3><p>Можно продолжить и при неполных данных — JURO покажет предупреждение.</p></div><div className="dbt-party-actions">
      {profile && canUseProfile && <button type="button" className="dbt-mini-button" onClick={() => update(side, partyFromProfile(profile))}><UserRoundCheck size={16}/>Данные профиля</button>}
      {profile && canUseProfile && <button type="button" className="dbt-mini-button" disabled={busy} onClick={async () => { setBusy(true); try { await onSaveProfile(party); } finally { setBusy(false); } }}><UserRoundCheck size={16}/>{busy ? "Сохраняем…" : "Сохранить в профиль"}</button>}
      {contacts.length > 0 && <label className="dbt-contact-picker"><UsersRound size={16}/><Select value={contactId} onChange={(event) => {
        const contact = contacts.find((item) => item.id === event.target.value);
        if (contact) update(side, partyFromContact(contact));
      }}><option value="">Выбрать контакт</option>{contacts.map((contact) => <option value={contact.id} key={contact.id}>{contact.label} — {contact.fullName}</option>)}</Select></label>}
    </div></div>
    {party.contactId && <div className="dbt-contact-update"><p className="dbt-inline-note">Изменения здесь не меняют сохранённый контакт автоматически.</p><button type="button" className="dbt-mini-button" onClick={() => setContactChoice((value) => !value)}>Выбрать, где применить изменения</button>{contactChoice && originalContact && <div className="dbt-contact-choice" role="group" aria-label="Применение изменений контакта"><button type="button" onClick={() => setContactChoice(false)}>Обновить только текущий документ</button><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await onUpdateContact(originalContact.id, party); update(side, partyFromContact(originalContact)); setContactChoice(false); } finally { setBusy(false); } }}>Применять новые данные только к будущим документам</button><button type="button" onClick={() => { update(side, partyFromContact(originalContact)); setContactChoice(false); }}>Оставить текущий документ без изменений</button></div>}</div>}
    <div className="dbt-fields-grid">
      <InputField label="Ф.И.О." value={party.fullName} onChange={(event) => update(`${side}.fullName`, event.target.value)} help="Укажите имя так, как оно написано в документе, удостоверяющем личность." example="Каримов Азиз Акмалович"/>
      <InputField label="Дата рождения" type="date" value={party.birthDate} onChange={(event) => update(`${side}.birthDate`, event.target.value)} help="Можно выбрать дату в календаре либо ввести её вручную."/>
      <SelectField label="Тип документа" value={party.idDocumentType} onChange={(event) => update(`${side}.idDocumentType`, event.target.value)}><option value="">Не выбран</option><option value="passport">Паспорт</option><option value="id_card">ID-карта</option></SelectField>
      <InputField label="Номер документа" value={party.idDocumentNumber} onChange={(event) => update(`${side}.idDocumentNumber`, event.target.value)} help="Серия и номер вводятся одним текстовым значением. Формат не ограничивается." example="AA 1234567"/>
      <InputField label="Кем выдан" value={party.idIssuedBy} onChange={(event) => update(`${side}.idIssuedBy`, event.target.value)} className="dbt-field-wide"/>
      <InputField label="Дата выдачи" type="date" value={party.idIssueDate} onChange={(event) => update(`${side}.idIssueDate`, event.target.value)}/>
      <InputField label="ПИНФЛ" value={party.pinfl} onChange={(event) => update(`${side}.pinfl`, event.target.value.replace(/[^0-9]/g, "").slice(0, 14))} inputMode="numeric" maxLength={14} pattern="[0-9]{14}" help="Введите ровно 14 цифр. JURO не сверяет ПИНФЛ по государственным базам."/>
      <InputField label="Номер телефона" value={party.phone} onChange={(event) => update(`${side}.phone`, event.target.value)} help="Вводится вручную без автоматического форматирования."/>
      <InputField label="Email — необязательно" value={party.email} onChange={(event) => update(`${side}.email`, event.target.value)} help="Email не проходит блокирующую форматную проверку."/>
      <TextAreaField label="Адрес регистрации" value={party.registeredAddress} onChange={(event) => update(`${side}.registeredAddress`, event.target.value)} className="dbt-field-wide" rows={2}/>
    </div>
  </div>);
}

function TransferDynamicFields({ answers, update, prefix, method, locale }: { answers: ReceiptAnswers; update: (path: string, value: unknown) => void; prefix: "transfer" | "repayment"; method: TransferMethod; locale: PlatformLocale }) {
  const current = answers[prefix];
  return localizeQuestionnaire(locale, <div className="dbt-fields-grid dbt-dynamic-fields">
    {method === "cash" && <>
      <InputField label="Дата" type="date" value={current.date} onChange={(event) => update(`${prefix}.date`, event.target.value)}/>
      <InputField label="Место" value={current.place} onChange={(event) => update(`${prefix}.place`, event.target.value)}/>
      {prefix === "transfer" && <Toggle label="При передаче присутствовали свидетели" checked={answers.transfer.witnessesPresent} onChange={(checked) => update("transfer.witnessesPresent", checked)}/>}
      <TextAreaField label="Дополнительный комментарий" value={current.comment} onChange={(event) => update(`${prefix}.comment`, event.target.value)} className="dbt-field-wide" rows={2}/>
    </>}
    {method === "bank" && <>
      <InputField label="Наименование банка" value={current.bankName} onChange={(event) => update(`${prefix}.bankName`, event.target.value)}/>
      <InputField label="Номер счёта или последние цифры" value={current.accountNumber} onChange={(event) => update(`${prefix}.accountNumber`, event.target.value)}/>
      {prefix === "transfer" && <InputField label="Дата перевода" type="date" value={answers.transfer.date} onChange={(event) => update("transfer.date", event.target.value)}/>}
      <InputField label="Номер или назначение платежа" value={current.paymentReference} onChange={(event) => update(`${prefix}.paymentReference`, event.target.value)} className="dbt-field-wide"/>
      {prefix === "transfer" && <TextAreaField label="Квитанция / подтверждающий документ" value={answers.transfer.confirmationDetails} onChange={(event) => update("transfer.confirmationDetails", event.target.value)} className="dbt-field-wide" rows={2}/>}
      <TextAreaField label="Дополнительный комментарий" value={current.comment} onChange={(event) => update(`${prefix}.comment`, event.target.value)} className="dbt-field-wide" rows={2}/>
    </>}
    {method === "card" && <>
      <InputField label="Наименование банка" value={current.bankName} onChange={(event) => update(`${prefix}.bankName`, event.target.value)}/>
      <InputField label="Последние 4 цифры карты отправителя" value={current.senderCardLast4} onChange={(event) => update(`${prefix}.senderCardLast4`, event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric"/>
      <InputField label="Последние 4 цифры карты получателя" value={current.recipientCardLast4} onChange={(event) => update(`${prefix}.recipientCardLast4`, event.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric"/>
      {prefix === "transfer" && <><InputField label="Дата перевода" type="date" value={answers.transfer.date} onChange={(event) => update("transfer.date", event.target.value)}/><InputField label="Время перевода" type="time" value={answers.transfer.time} onChange={(event) => update("transfer.time", event.target.value)}/><InputField label="Сумма перевода" value={answers.transfer.transferredAmount} onChange={(event) => update("transfer.transferredAmount", event.target.value)} inputMode="decimal"/></>}
      <InputField label="Номер транзакции" value={current.transactionNumber} onChange={(event) => update(`${prefix}.transactionNumber`, event.target.value)}/>
      {prefix === "transfer" && <TextAreaField label="Квитанция или скриншот" value={answers.transfer.confirmationDetails} onChange={(event) => update("transfer.confirmationDetails", event.target.value)} className="dbt-field-wide" rows={2}/>}
      <TextAreaField label="Дополнительный комментарий" value={current.comment} onChange={(event) => update(`${prefix}.comment`, event.target.value)} className="dbt-field-wide" rows={2}/>
    </>}
    {method === "other" && <>
      {prefix === "transfer" ? <><InputField label="Наименование способа" value={answers.transfer.otherMethodName} onChange={(event) => update("transfer.otherMethodName", event.target.value)}/><InputField label="Дата" type="date" value={answers.transfer.date} onChange={(event) => update("transfer.date", event.target.value)}/><InputField label="Место или канал" value={answers.transfer.channel} onChange={(event) => update("transfer.channel", event.target.value)}/><TextAreaField label="Реквизиты / подтверждение" value={answers.transfer.confirmationDetails} onChange={(event) => update("transfer.confirmationDetails", event.target.value)} className="dbt-field-wide" rows={2}/><Toggle label="Присутствовали свидетели" checked={answers.transfer.witnessesPresent} onChange={(checked) => update("transfer.witnessesPresent", checked)}/></> : <TextAreaField label="Свободные сведения о способе возврата" value={answers.repayment.otherDetails} onChange={(event) => update("repayment.otherDetails", event.target.value)} className="dbt-field-wide" rows={3}/>}
      <TextAreaField label="Дополнительный комментарий" value={current.comment} onChange={(event) => update(`${prefix}.comment`, event.target.value)} className="dbt-field-wide" rows={2}/>
    </>}
  </div>);
}

export function BuilderQuestionnaire({ answers, onChange, step, profile, contacts, onSaveProfile, onUpdateContact, locale = "ru" }: Props) {
  const update = (path: string, value: unknown) => onChange(setPath(answers, path, value));
  const profileSide = answers.participantMode === "self" ? answers.actingSide : null;
  const numberLocale = builderIntlLocale(locale);
  if (step === 0) return localizeQuestionnaire(locale, <div className="dbt-step-content">
    <FormSection title="Кто участвует в создании документа?" description="Роль запрашивается отдельно для каждой новой расписки.">
      <ChoiceGroup label="Ваша роль" value={answers.participantMode} onChange={(value) => {
        const next = setPath(answers, "participantMode", value);
        onChange(setPath(next, "actingSide", value === "organization" ? "organization" : value === "for_other" ? "lender" : "lender"));
      }} options={[
        { value: "self", label: "Я являюсь одной из сторон", description: "Создаю расписку для себя" },
        { value: "for_other", label: "Я создаю документ за другого человека", description: "Заполняю сведения по поручению стороны" },
        { value: "organization", label: "Я представляю организацию/компанию", description: "Продолжить с шаблоном для физических лиц" },
      ]}/>
      {answers.participantMode === "self" && <ChoiceGroup label="Кем вы являетесь?" value={answers.actingSide as "lender" | "borrower"} onChange={(value) => update("actingSide", value)} options={[{ value: "lender", label: "Я займодавец" }, { value: "borrower", label: "Я заемщик" }]}/>}
      {answers.participantMode === "for_other" && <ChoiceGroup label="За кого создаётся документ?" value={answers.actingSide as "lender" | "borrower" | "both"} onChange={(value) => update("actingSide", value)} options={[{ value: "lender", label: "За займодавца" }, { value: "borrower", label: "За заемщика" }, { value: "both", label: "За обе стороны" }]}/>}
      {answers.participantMode === "organization" && <div className="dbt-warning">Данный шаблон предназначен преимущественно для физических лиц. Для организаций рекомендуется использовать специализированные шаблоны документов.</div>}
    </FormSection>
    <FormSection title="Место и дата составления">
      <div className="dbt-fields-grid"><InputField label="Место составления" value={answers.documentPlace} onChange={(event) => update("documentPlace", event.target.value)} help="Укажите населённый пункт, где стороны подпишут расписку." example="г. Ташкент"/><InputField label="Дата составления" type="date" value={answers.documentDate} onChange={(event) => update("documentDate", event.target.value)}/></div>
    </FormSection>
    <FormSection title="Стороны">
      <PartyForm title="Займодавец" side="lender" party={answers.lender} update={update} contacts={contacts} profile={profile} canUseProfile={profileSide === "lender"} onSaveProfile={onSaveProfile} onUpdateContact={onUpdateContact} locale={locale}/>
      <PartyForm title="Заемщик" side="borrower" party={answers.borrower} update={update} contacts={contacts} profile={profile} canUseProfile={profileSide === "borrower"} onSaveProfile={onSaveProfile} onUpdateContact={onUpdateContact} locale={locale}/>
    </FormSection>
  </div>);

  if (step === 1) return localizeQuestionnaire(locale, <div className="dbt-step-content">
    <FormSection title="Сумма и срок займа">
      <div className="dbt-fields-grid"><InputField label="Дата фактической передачи денег" type="date" value={answers.loanTransferDate} onChange={(event) => update("loanTransferDate", event.target.value)}/><InputField label="Срок возврата" type="date" value={answers.loanRepaymentDate} onChange={(event) => update("loanRepaymentDate", event.target.value)}/><InputField label="Сумма цифрами" value={answers.loanAmountNumeric} onChange={(event) => update("loanAmountNumeric", event.target.value)} inputMode="decimal" help="Допустимы цифры, пробелы, точка или запятая для центов." example="25000000"/><SelectField label="Валюта" value={answers.currency} onChange={(event) => update("currency", event.target.value)}><option value="UZS">Узбекский сум</option><option value="USD">Доллар США</option></SelectField>{answers.currency === "USD" && <Toggle label="Учитывать доллары и центы" checked={answers.includeCents} onChange={(checked) => update("includeCents", checked)}/>}<TextAreaField label="Сумма прописью" value={answers.loanAmountWords} onChange={(event) => {
        const next = setPath(answers, "loanAmountWords", event.target.value);
        onChange(setPath(next, "loanAmountWordsManuallyEdited", true));
      }} className="dbt-field-wide" rows={2} help="JURO формирует значение автоматически. Вы можете исправить его вручную; AI-проверка сравнит обе суммы."/></div>
    </FormSection>
    <FormSection title="Проценты за пользование займом">
      <ChoiceGroup label="Режим займа" value={answers.interest.mode} onChange={(value) => update("interest.mode", value)} options={[{ value: "interest_free", label: "Беспроцентный займ" }, { value: "interest", label: "Процентный займ" }, { value: "other", label: "Иной порядок" }]}/>
      {answers.interest.mode === "interest" && <div className="dbt-fields-grid"><InputField label="Процентная ставка, %" value={answers.interest.rate} onChange={(event) => update("interest.rate", event.target.value)} inputMode="decimal"/><SelectField label="Период начисления" value={answers.interest.period} onChange={(event) => update("interest.period", event.target.value)}><option value="month">Месяц</option><option value="year">Год</option><option value="other">Иной</option></SelectField>{answers.interest.period === "other" && <InputField label="Иной период" value={answers.interest.customPeriod} onChange={(event) => update("interest.customPeriod", event.target.value)}/>}<SelectField label="Порядок уплаты" value={answers.interest.paymentOrder} onChange={(event) => update("interest.paymentOrder", event.target.value)}><option value="with_principal">Вместе с основной суммой</option><option value="monthly">Ежемесячно</option><option value="other">По другому графику</option></SelectField>{answers.interest.paymentOrder === "other" && <InputField label="Другой порядок уплаты" value={answers.interest.customPaymentOrder} onChange={(event) => update("interest.customPaymentOrder", event.target.value)}/>}<TextAreaField label="Дополнительные условия" value={answers.interest.additionalTerms} onChange={(event) => update("interest.additionalTerms", event.target.value)} className="dbt-field-wide" rows={3}/></div>}
      {answers.interest.mode === "other" && <TextAreaField label="Опишите иной порядок" value={answers.interest.otherTerms} onChange={(event) => update("interest.otherTerms", event.target.value)} rows={4}/>}
    </FormSection>
    <FormSection title="Досрочный возврат">
      <ChoiceGroup label="Допускается ли досрочный возврат?" value={answers.earlyRepaymentMode} onChange={(value) => update("earlyRepaymentMode", value)} options={[{ value: "allow", label: "Разрешить" }, { value: "deny", label: "Запретить без согласия займодавца" }, { value: "conditional", label: "Разрешить на определённых условиях" }]}/>
      {answers.earlyRepaymentMode === "conditional" && <TextAreaField label="Условия досрочного возврата" value={answers.earlyRepaymentCustom} onChange={(event) => update("earlyRepaymentCustom", event.target.value)} rows={3}/>}
    </FormSection>
  </div>);

  if (step === 2) {
    const scheduleTotal = answers.repayment.schedule.reduce((sum, item) => sum + (parseAmount(item.amount) ?? 0), 0);
    const loanAmount = parseAmount(answers.loanAmountNumeric) ?? 0;
    return localizeQuestionnaire(locale, <div className="dbt-step-content">
      <FormSection title="Передача денежных средств">
        <ChoiceGroup label="Способ передачи" value={answers.transfer.method} onChange={(value) => update("transfer.method", value)} options={[{ value: "cash", label: "Наличными" }, { value: "bank", label: "Банковским переводом" }, { value: "card", label: "На банковскую карту" }, { value: "other", label: "Иным способом" }]}/>
        <TransferDynamicFields answers={answers} update={update} prefix="transfer" method={answers.transfer.method} locale={locale}/>
      </FormSection>
      <FormSection title="Возврат займа">
        <ChoiceGroup label="Порядок возврата" value={answers.repayment.planType} onChange={(value) => update("repayment.planType", value)} options={[{ value: "single", label: "Один платёж" }, { value: "schedule", label: "Частями по графику" }]}/>
        {answers.repayment.planType === "single" ? <><ChoiceGroup label="Способ возврата" value={answers.repayment.method} onChange={(value) => update("repayment.method", value)} options={[{ value: "cash", label: "Наличными" }, { value: "bank", label: "Банковским переводом" }, { value: "card", label: "На банковскую карту" }, { value: "other", label: "Иным способом" }]}/><TransferDynamicFields answers={answers} update={update} prefix="repayment" method={answers.repayment.method} locale={locale}/></> : <div className="dbt-schedule"><div className="dbt-schedule-head"><strong>График частичных платежей</strong><button type="button" className="dbt-mini-button" onClick={() => update("repayment.schedule", [...answers.repayment.schedule, newScheduleItem()])}><Plus size={16}/>Добавить платёж</button></div>{answers.repayment.schedule.map((item, index) => <div className="dbt-schedule-row" key={item.id}><span>{index + 1}</span><InputField label="Дата" type="date" value={item.date} onChange={(event) => {
          const schedule = [...answers.repayment.schedule]; schedule[index] = { ...item, date: event.target.value }; update("repayment.schedule", schedule);
        }}/><InputField label="Сумма" value={item.amount} inputMode="decimal" onChange={(event) => { const schedule = [...answers.repayment.schedule]; schedule[index] = { ...item, amount: event.target.value }; update("repayment.schedule", schedule); }}/><SelectField label="Способ" value={item.method} onChange={(event) => { const schedule = [...answers.repayment.schedule]; schedule[index] = { ...item, method: event.target.value as TransferMethod }; update("repayment.schedule", schedule); }}><option value="cash">Наличные</option><option value="bank">Банк</option><option value="card">Карта</option><option value="other">Иной</option></SelectField><InputField label="Комментарий" value={item.comment} onChange={(event) => { const schedule = [...answers.repayment.schedule]; schedule[index] = { ...item, comment: event.target.value }; update("repayment.schedule", schedule); }}/><button type="button" className="dbt-icon-danger" aria-label={`Удалить платёж ${index + 1}`} onClick={() => update("repayment.schedule", answers.repayment.schedule.filter((row) => row.id !== item.id))}><Trash2 size={17}/></button></div>)}<div className={`dbt-schedule-total ${Math.abs(scheduleTotal - loanAmount) > .009 ? "mismatch" : "match"}`}><span>Итого по графику</span><strong>{scheduleTotal.toLocaleString(numberLocale)}</strong><small>{Math.abs(scheduleTotal - loanAmount) > .009 ? `Не совпадает с суммой займа: ${loanAmount.toLocaleString(numberLocale)}` : "Совпадает с суммой займа"}</small></div></div>}
      </FormSection>
    </div>);
  }

  if (step === 3) return localizeQuestionnaire(locale, <div className="dbt-step-content">
    <FormSection title="Ответственность">
      <ChoiceGroup label="Как оформить раздел?" value={answers.responsibilityMode} onChange={(value) => update("responsibilityMode", value)} options={[{ value: "standard", label: "Включить стандартный юридический блок" }, { value: "exclude", label: "Не включать блок" }, { value: "custom", label: "Добавить собственные условия" }]}/>
      {answers.responsibilityMode === "custom" && <TextAreaField label="Собственные условия ответственности" value={answers.responsibilityCustom} onChange={(event) => update("responsibilityCustom", event.target.value)} rows={5}/>}
    </FormSection>
    <FormSection title="Уведомления">
      <ChoiceGroup label="Как оформить раздел?" value={answers.noticesMode} onChange={(value) => update("noticesMode", value)} options={[{ value: "standard", label: "Включить стандартный блок" }, { value: "exclude", label: "Не включать" }, { value: "custom", label: "Добавить собственные условия" }]}/>
      {answers.noticesMode === "standard" && <div className="dbt-fields-grid"><TextAreaField label="Контакты займодавца для уведомлений" value={answers.lender.noticeDetails} onChange={(event) => update("lender.noticeDetails", event.target.value)} rows={2}/><TextAreaField label="Контакты заемщика для уведомлений" value={answers.borrower.noticeDetails} onChange={(event) => update("borrower.noticeDetails", event.target.value)} rows={2}/><InputField label="Срок уведомления, календарных дней" value={answers.notificationPeriod} onChange={(event) => update("notificationPeriod", event.target.value)} inputMode="numeric"/></div>}
      {answers.noticesMode === "custom" && <TextAreaField label="Собственные условия уведомлений" value={answers.noticesCustom} onChange={(event) => update("noticesCustom", event.target.value)} rows={5}/>}
    </FormSection>
    <FormSection title="Свидетели">
      <Toggle label="При подписании будут свидетели" checked={answers.hasWitnesses} onChange={(checked) => update("hasWitnesses", checked)}/>
      {answers.hasWitnesses && <div className="dbt-witnesses">{answers.witnesses.map((witness, index) => <div className="dbt-witness" key={witness.id}><div className="dbt-witness-head"><h3>Свидетель {index + 1}</h3><button type="button" className="dbt-icon-danger" aria-label={`Удалить свидетеля ${index + 1}`} onClick={() => update("witnesses", answers.witnesses.filter((item) => item.id !== witness.id))}><Trash2 size={17}/></button></div><div className="dbt-fields-grid"><InputField label="Ф.И.О." value={witness.fullName} onChange={(event) => { const rows = [...answers.witnesses]; rows[index] = { ...witness, fullName: event.target.value }; update("witnesses", rows); }}/><InputField label="Дата рождения" type="date" value={witness.birthDate} onChange={(event) => { const rows = [...answers.witnesses]; rows[index] = { ...witness, birthDate: event.target.value }; update("witnesses", rows); }}/><SelectField label="Тип документа" value={witness.idDocumentType} onChange={(event) => { const rows = [...answers.witnesses]; rows[index] = { ...witness, idDocumentType: event.target.value as PartyDetails["idDocumentType"] }; update("witnesses", rows); }}><option value="">Не выбран</option><option value="passport">Паспорт</option><option value="id_card">ID-карта</option></SelectField><InputField label="Номер документа" value={witness.idDocumentNumber} onChange={(event) => { const rows = [...answers.witnesses]; rows[index] = { ...witness, idDocumentNumber: event.target.value }; update("witnesses", rows); }}/><InputField label="ПИНФЛ" value={witness.pinfl} inputMode="numeric" maxLength={14} pattern="[0-9]{14}" onChange={(event) => { const rows = [...answers.witnesses]; rows[index] = { ...witness, pinfl: event.target.value.replace(/[^0-9]/g, "").slice(0, 14) }; update("witnesses", rows); }}/><InputField label="Телефон" value={witness.phone} onChange={(event) => { const rows = [...answers.witnesses]; rows[index] = { ...witness, phone: event.target.value }; update("witnesses", rows); }}/><TextAreaField label="Адрес регистрации" value={witness.registeredAddress} onChange={(event) => { const rows = [...answers.witnesses]; rows[index] = { ...witness, registeredAddress: event.target.value }; update("witnesses", rows); }} className="dbt-field-wide" rows={2}/></div><p className="dbt-signature-preview">Строка подписи будет добавлена автоматически.</p></div>)}<button type="button" className="dbt-mini-button" onClick={() => update("witnesses", [...answers.witnesses, newWitness()])}><Plus size={16}/>Добавить свидетеля</button></div>}
    </FormSection>
    <FormSection title="Дополнительные условия"><TextAreaField label="Другие условия сторон" value={answers.additionalTerms} onChange={(event) => update("additionalTerms", event.target.value)} rows={5} help="Добавляйте только условия, согласованные сторонами. Они появятся в заключительных положениях."/></FormSection>
  </div>);

  return localizeQuestionnaire(locale, <div className="dbt-step-content">
    <FormSection title="Проверка перед созданием" description="Предупреждения не блокируют формирование документа.">
      <div className="dbt-final-checks"><p><span className={answers.lender.fullName && answers.borrower.fullName ? "ok" : "warn"}/><strong>Данные сторон заполнены</strong><small>Допускаются неполные данные, но это влияет на оценку.</small></p><p><span className={parseAmount(answers.loanAmountNumeric) ? "ok" : "warn"}/><strong>Сумма указана</strong></p><p><span className={answers.loanRepaymentDate ? "ok" : "warn"}/><strong>Срок возврата указан</strong></p><p><span className="ok"/><strong>Обязательные поля проверены</strong><small>Технически документ можно сформировать и с предупреждениями.</small></p></div>
      <label className="dbt-confirmation"><input type="checkbox" checked={answers.accuracyConfirmed} onChange={(event) => update("accuracyConfirmed", event.target.checked)}/><span>Я подтверждаю, что введённые данные достоверны, JURO не является стороной расписки, а шаблон не заменяет индивидуальную консультацию юриста.</span></label>
    </FormSection>
  </div>);
}
