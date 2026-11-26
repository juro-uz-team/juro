import { formatNumericAmount } from "../money-to-words";
import type {
  DocumentLanguage,
  PartyDetails,
  ReceiptAnswers,
  RenderedParagraph,
  RenderedReceipt,
  PreviewPart,
  TransferMethod,
  WitnessDetails,
} from "../types";

const blank = "________________";

type BindField = (key: string, text: string) => string;
const renderField: BindField = (_key, text) => text;

function value(input: string | null | undefined): string {
  return input?.trim() || blank;
}

function date(input: string, language: DocumentLanguage): string {
  if (!input) return blank;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) return input;
  const [, year, month, day] = match;
  return language === "ru" ? `${day}.${month}.${year}` : `${day}.${month}.${year}`;
}

function documentType(type: PartyDetails["idDocumentType"], language: DocumentLanguage): string {
  if (language === "uz-cyrl") {
    return type === "passport" ? "паспорт" : type === "id_card" ? "ИД-карта" : blank;
  }
  return type === "passport" ? "паспорт" : type === "id_card" ? "ID-карта" : blank;
}

function ruParty(party: PartyDetails, role: "lender" | "borrower", bind: BindField): string {
  const roleName = role === "lender" ? "«Займодавец»" : "«Заемщик»";
  return `${bind(`${role}.fullName`, value(party.fullName))}, дата рождения: ${bind(`${role}.birthDate`, date(party.birthDate, "ru"))}, ${bind(`${role}.idDocumentType`, documentType(party.idDocumentType, "ru"))}: ${bind(`${role}.idDocumentNumber`, value(party.idDocumentNumber))}, выдан(а) ${bind(`${role}.idIssuedBy`, value(party.idIssuedBy))} ${bind(`${role}.idIssueDate`, date(party.idIssueDate, "ru"))}, ПИНФЛ: ${bind(`${role}.pinfl`, value(party.pinfl))}, зарегистрированный(ая) по адресу: ${bind(`${role}.registeredAddress`, value(party.registeredAddress))}, номер телефона: ${bind(`${role}.phone`, value(party.phone))}, именуемый(ая) в дальнейшем ${roleName}${role === "lender" ? "," : "."}`;
}

function uzParty(party: PartyDetails, role: "lender" | "borrower", bind: BindField): string {
  const roleName = role === "lender" ? "«Қарз берувчи»" : "«Қарз олувчи»";
  return `${bind(`${role}.fullName`, value(party.fullName))}, туғилган сана: ${bind(`${role}.birthDate`, date(party.birthDate, "uz-cyrl"))}, ${bind(`${role}.idDocumentType`, documentType(party.idDocumentType, "uz-cyrl"))}: ${bind(`${role}.idDocumentNumber`, value(party.idDocumentNumber))}, ${bind(`${role}.idIssuedBy`, value(party.idIssuedBy))} томонидан ${bind(`${role}.idIssueDate`, date(party.idIssueDate, "uz-cyrl"))} санасида берилган, ЖШШИР: ${bind(`${role}.pinfl`, value(party.pinfl))}, рўйхатдан ўтган манзили: ${bind(`${role}.registeredAddress`, value(party.registeredAddress))}, телефон рақами: ${bind(`${role}.phone`, value(party.phone))}, кейинги ўринларда ${roleName} деб аталувчи шахс${role === "lender" ? "," : "."}`;
}

const ruTransferNames: Record<TransferMethod, string> = {
  cash: "наличными денежными средствами",
  bank: "банковским переводом",
  card: "переводом на банковскую карту",
  other: "иным согласованным сторонами способом",
};

const uzTransferNames: Record<TransferMethod, string> = {
  cash: "нақд пул маблағлари билан",
  bank: "банк ўтказмаси орқали",
  card: "банк картасига ўтказиш орқали",
  other: "тарафлар келишган бошқа усулда",
};

function joinDetails(items: Array<[string, string | boolean | undefined]>, separator = "; "): string {
  const rendered = items
    .filter(([, item]) => item !== "" && item !== undefined && item !== false)
    .map(([label, item]) => `${label}: ${item === true ? "да" : item}`);
  return rendered.length ? rendered.join(separator) : blank;
}

export function transferMethodText(answers: ReceiptAnswers): string {
  const lang = answers.language;
  const transfer = answers.transfer;
  return lang === "ru" ? ruTransferNames[transfer.method] : uzTransferNames[transfer.method];
}

export function transferDetailsText(answers: ReceiptAnswers, bind: BindField = renderField): string {
  const t = answers.transfer;
  const lang = answers.language;
  if (lang === "ru") {
    if (t.method === "cash") {
      return joinDetails([
        ["дата передачи", bind(t.date ? "transfer.date" : "loanTransferDate", date(t.date || answers.loanTransferDate, lang))],
        ["место передачи", t.place && bind("transfer.place", t.place)],
        ["свидетели присутствовали", t.witnessesPresent ? "да" : "нет"],
        ["комментарий", t.comment && bind("transfer.comment", t.comment)],
      ]);
    }
    if (t.method === "bank") {
      return joinDetails([
        ["банк", t.bankName && bind("transfer.bankName", t.bankName)],
        ["счёт", t.accountNumber && bind("transfer.accountNumber", t.accountNumber)],
        ["дата перевода", bind(t.date ? "transfer.date" : "loanTransferDate", date(t.date || answers.loanTransferDate, lang))],
        ["номер или назначение платежа", t.paymentReference && bind("transfer.paymentReference", t.paymentReference)],
        ["подтверждение", t.confirmationDetails && bind("transfer.confirmationDetails", t.confirmationDetails)],
        ["комментарий", t.comment && bind("transfer.comment", t.comment)],
      ]);
    }
    if (t.method === "card") {
      return joinDetails([
        ["банк", t.bankName && bind("transfer.bankName", t.bankName)],
        ["последние четыре цифры карты отправителя", t.senderCardLast4 && bind("transfer.senderCardLast4", t.senderCardLast4)],
        ["последние четыре цифры карты получателя", t.recipientCardLast4 && bind("transfer.recipientCardLast4", t.recipientCardLast4)],
        ["дата перевода", bind(t.date ? "transfer.date" : "loanTransferDate", date(t.date || answers.loanTransferDate, lang))],
        ["время перевода", t.time && bind("transfer.time", t.time)],
        ["сумма перевода", t.transferredAmount && bind("transfer.transferredAmount", t.transferredAmount)],
        ["номер транзакции", t.transactionNumber && bind("transfer.transactionNumber", t.transactionNumber)],
        ["подтверждение", t.confirmationDetails && bind("transfer.confirmationDetails", t.confirmationDetails)],
        ["комментарий", t.comment && bind("transfer.comment", t.comment)],
      ]);
    }
    return joinDetails([
      ["способ", t.otherMethodName && bind("transfer.otherMethodName", t.otherMethodName)],
      ["дата", bind(t.date ? "transfer.date" : "loanTransferDate", date(t.date || answers.loanTransferDate, lang))],
      ["место или канал", t.channel || t.place],
      ["реквизиты или подтверждение", t.confirmationDetails && bind("transfer.confirmationDetails", t.confirmationDetails)],
      ["свидетели присутствовали", t.witnessesPresent ? "да" : "нет"],
      ["комментарий", t.comment && bind("transfer.comment", t.comment)],
    ]);
  }

  if (t.method === "cash") {
    return joinDetails([
      ["топшириш санаси", bind(t.date ? "transfer.date" : "loanTransferDate", date(t.date || answers.loanTransferDate, lang))],
      ["топшириш жойи", t.place && bind("transfer.place", t.place)],
      ["гувоҳлар иштирок этган", t.witnessesPresent ? "ҳа" : "йўқ"],
      ["изоҳ", t.comment && bind("transfer.comment", t.comment)],
    ]);
  }
  if (t.method === "bank") {
    return joinDetails([
      ["банк", t.bankName && bind("transfer.bankName", t.bankName)],
      ["ҳисобварақ", t.accountNumber && bind("transfer.accountNumber", t.accountNumber)],
      ["ўтказма санаси", bind(t.date ? "transfer.date" : "loanTransferDate", date(t.date || answers.loanTransferDate, lang))],
      ["тўлов рақами ёки мақсади", t.paymentReference && bind("transfer.paymentReference", t.paymentReference)],
      ["тасдиқловчи ҳужжат", t.confirmationDetails && bind("transfer.confirmationDetails", t.confirmationDetails)],
      ["изоҳ", t.comment && bind("transfer.comment", t.comment)],
    ]);
  }
  if (t.method === "card") {
    return joinDetails([
      ["банк", t.bankName && bind("transfer.bankName", t.bankName)],
      ["жўнатувчи картасининг охирги тўрт рақами", t.senderCardLast4 && bind("transfer.senderCardLast4", t.senderCardLast4)],
      ["олувчи картасининг охирги тўрт рақами", t.recipientCardLast4 && bind("transfer.recipientCardLast4", t.recipientCardLast4)],
      ["ўтказма санаси", bind(t.date ? "transfer.date" : "loanTransferDate", date(t.date || answers.loanTransferDate, lang))],
      ["ўтказма вақти", t.time && bind("transfer.time", t.time)],
      ["ўтказма суммаси", t.transferredAmount && bind("transfer.transferredAmount", t.transferredAmount)],
      ["транзакция рақами", t.transactionNumber && bind("transfer.transactionNumber", t.transactionNumber)],
      ["тасдиқловчи ҳужжат", t.confirmationDetails && bind("transfer.confirmationDetails", t.confirmationDetails)],
      ["изоҳ", t.comment && bind("transfer.comment", t.comment)],
    ]);
  }
  return joinDetails([
    ["усул", t.otherMethodName && bind("transfer.otherMethodName", t.otherMethodName)],
    ["сана", bind(t.date ? "transfer.date" : "loanTransferDate", date(t.date || answers.loanTransferDate, lang))],
    ["жой ёки канал", t.channel || t.place],
    ["реквизитлар ёки тасдиқ", t.confirmationDetails && bind("transfer.confirmationDetails", t.confirmationDetails)],
    ["гувоҳлар иштирок этган", t.witnessesPresent ? "ҳа" : "йўқ"],
    ["изоҳ", t.comment && bind("transfer.comment", t.comment)],
  ]);
}

export function repaymentMethodText(answers: ReceiptAnswers): string {
  const r = answers.repayment;
  if (r.planType === "schedule") {
    return answers.language === "ru" ? "частями по согласованному графику платежей" : "келишилган тўловлар жадвали бўйича қисмларга бўлиб";
  }
  return answers.language === "ru" ? ruTransferNames[r.method] : uzTransferNames[r.method];
}

export function repaymentDetailsText(answers: ReceiptAnswers, bind: BindField = renderField): string {
  const r = answers.repayment;
  const lang = answers.language;
  if (r.planType === "schedule") {
    const rows = r.schedule.map((row, index) => {
      const method = lang === "ru" ? ruTransferNames[row.method] : uzTransferNames[row.method];
      return lang === "ru"
        ? `${index + 1}) ${bind(`repayment.schedule.${index}.date`, date(row.date, lang))} — ${bind(`repayment.schedule.${index}.amount`, value(row.amount))} — ${method}${row.comment ? `; ${row.comment}` : ""}`
        : `${index + 1}) ${bind(`repayment.schedule.${index}.date`, date(row.date, lang))} — ${bind(`repayment.schedule.${index}.amount`, value(row.amount))} — ${method}${row.comment ? `; ${row.comment}` : ""}`;
    });
    return rows.length ? rows.join("\n") : blank;
  }
  if (lang === "ru") {
    if (r.method === "cash") return joinDetails([["дата", bind(r.date ? "repayment.date" : "loanRepaymentDate", date(r.date || answers.loanRepaymentDate, lang))], ["место", r.place && bind("repayment.place", r.place)], ["комментарий", r.comment && bind("repayment.comment", r.comment)]]);
    if (r.method === "bank") return joinDetails([["банк", r.bankName && bind("repayment.bankName", r.bankName)], ["счёт", r.accountNumber && bind("repayment.accountNumber", r.accountNumber)], ["назначение", r.paymentReference && bind("repayment.paymentReference", r.paymentReference)], ["комментарий", r.comment && bind("repayment.comment", r.comment)]]);
    if (r.method === "card") return joinDetails([["банк", r.bankName && bind("repayment.bankName", r.bankName)], ["карта отправителя", r.senderCardLast4 && bind("repayment.senderCardLast4", r.senderCardLast4)], ["карта получателя", r.recipientCardLast4 && bind("repayment.recipientCardLast4", r.recipientCardLast4)], ["транзакция", r.transactionNumber && bind("repayment.transactionNumber", r.transactionNumber)], ["комментарий", r.comment && bind("repayment.comment", r.comment)]]);
    return joinDetails([["сведения", r.otherDetails && bind("repayment.otherDetails", r.otherDetails)], ["комментарий", r.comment && bind("repayment.comment", r.comment)]]);
  }
  if (r.method === "cash") return joinDetails([["сана", bind(r.date ? "repayment.date" : "loanRepaymentDate", date(r.date || answers.loanRepaymentDate, lang))], ["жой", r.place && bind("repayment.place", r.place)], ["изоҳ", r.comment && bind("repayment.comment", r.comment)]]);
  if (r.method === "bank") return joinDetails([["банк", r.bankName && bind("repayment.bankName", r.bankName)], ["ҳисобварақ", r.accountNumber && bind("repayment.accountNumber", r.accountNumber)], ["тўлов мақсади", r.paymentReference && bind("repayment.paymentReference", r.paymentReference)], ["изоҳ", r.comment && bind("repayment.comment", r.comment)]]);
  if (r.method === "card") return joinDetails([["банк", r.bankName && bind("repayment.bankName", r.bankName)], ["жўнатувчи картаси", r.senderCardLast4 && bind("repayment.senderCardLast4", r.senderCardLast4)], ["олувчи картаси", r.recipientCardLast4 && bind("repayment.recipientCardLast4", r.recipientCardLast4)], ["транзакция", r.transactionNumber && bind("repayment.transactionNumber", r.transactionNumber)], ["изоҳ", r.comment && bind("repayment.comment", r.comment)]]);
  return joinDetails([["маълумотлар", r.otherDetails && bind("repayment.otherDetails", r.otherDetails)], ["изоҳ", r.comment && bind("repayment.comment", r.comment)]]);
}

export function interestTermsText(answers: ReceiptAnswers, bind: BindField = renderField): string {
  const i = answers.interest;
  if (answers.language === "ru") {
    if (i.mode === "interest_free") return "Заем является беспроцентным. Заемщик не обязан уплачивать проценты за пользование суммой займа.";
    if (i.mode === "other") return bind("interest.otherTerms", value(i.otherTerms));
    const period = i.period === "month" ? "в месяц" : i.period === "year" ? "в год" : bind("interest.customPeriod", value(i.customPeriod));
    const payment = i.paymentOrder === "with_principal" ? "одновременно с возвратом основной суммы займа" : i.paymentOrder === "monthly" ? "ежемесячно" : bind("interest.customPaymentOrder", value(i.customPaymentOrder));
    return `Заем является процентным. Процентная ставка составляет ${bind("interest.rate", value(i.rate))}% ${period}. Проценты уплачиваются ${payment}.${i.additionalTerms ? ` ${i.additionalTerms}` : ""}`;
  }
  if (i.mode === "interest_free") return "Қарз фоизсиз ҳисобланади. Қарз олувчи қарз суммасидан фойдаланганлик учун фоиз тўламайди.";
  if (i.mode === "other") return bind("interest.otherTerms", value(i.otherTerms));
  const period = i.period === "month" ? "ойига" : i.period === "year" ? "йилига" : bind("interest.customPeriod", value(i.customPeriod));
  const payment = i.paymentOrder === "with_principal" ? "асосий қарз суммаси қайтарилиши билан бир вақтда" : i.paymentOrder === "monthly" ? "ҳар ой" : bind("interest.customPaymentOrder", value(i.customPaymentOrder));
  return `Қарз фоизли ҳисобланади. Фоиз ставкаси ${bind("interest.rate", value(i.rate))}% ${period}ни ташкил этади. Фоизлар ${payment} тўланади.${i.additionalTerms ? ` ${i.additionalTerms}` : ""}`;
}

export function earlyRepaymentText(answers: ReceiptAnswers, bind: BindField = renderField): string {
  if (answers.language === "ru") {
    if (answers.earlyRepaymentMode === "allow") return "Досрочный возврат суммы займа допускается без дополнительного согласия Займодавца.";
    if (answers.earlyRepaymentMode === "deny") return "Досрочный возврат суммы займа не допускается без предварительного письменного согласия Займодавца.";
    return `Досрочный возврат суммы займа допускается на следующих условиях: ${bind("earlyRepaymentCustom", value(answers.earlyRepaymentCustom))}.`;
  }
  if (answers.earlyRepaymentMode === "allow") return "Қарз суммасини Қарз берувчининг қўшимча розилигисиз муддатидан олдин қайтаришга йўл қўйилади.";
  if (answers.earlyRepaymentMode === "deny") return "Қарз берувчининг олдиндан ёзма розилигисиз қарз суммасини муддатидан олдин қайтаришга йўл қўйилмайди.";
  return `Қарз суммасини қуйидаги шартларда муддатидан олдин қайтаришга йўл қўйилади: ${bind("earlyRepaymentCustom", value(answers.earlyRepaymentCustom))}.`;
}

function witnessText(witness: WitnessDetails, index: number, language: DocumentLanguage, bind: BindField): string[] {
  if (language === "ru") {
    return [
      `${index}. ${bind(`witnesses.${index - 1}.fullName`, value(witness.fullName))}, дата рождения: ${bind(`witnesses.${index - 1}.birthDate`, date(witness.birthDate, language))}, ${bind(`witnesses.${index - 1}.idDocumentType`, documentType(witness.idDocumentType, language))}: ${bind(`witnesses.${index - 1}.idDocumentNumber`, value(witness.idDocumentNumber))}, ПИНФЛ: ${bind(`witnesses.${index - 1}.pinfl`, value(witness.pinfl))}, адрес регистрации: ${bind(`witnesses.${index - 1}.registeredAddress`, value(witness.registeredAddress))}, телефон: ${bind(`witnesses.${index - 1}.phone`, value(witness.phone))}.`,
      `Подпись свидетеля: __________________ / ${bind(`witnesses.${index - 1}.fullName`, value(witness.fullName))}`,
    ];
  }
  return [
    `${index}. ${bind(`witnesses.${index - 1}.fullName`, value(witness.fullName))}, туғилган сана: ${bind(`witnesses.${index - 1}.birthDate`, date(witness.birthDate, language))}, ${bind(`witnesses.${index - 1}.idDocumentType`, documentType(witness.idDocumentType, language))}: ${bind(`witnesses.${index - 1}.idDocumentNumber`, value(witness.idDocumentNumber))}, ЖШШИР: ${bind(`witnesses.${index - 1}.pinfl`, value(witness.pinfl))}, рўйхатдан ўтган манзили: ${bind(`witnesses.${index - 1}.registeredAddress`, value(witness.registeredAddress))}, телефон: ${bind(`witnesses.${index - 1}.phone`, value(witness.phone))}.`,
    `Гувоҳнинг имзоси: __________________ / ${bind(`witnesses.${index - 1}.fullName`, value(witness.fullName))}`,
  ];
}

type Push = (text: string, kind?: RenderedParagraph["kind"], id?: string, keepWithNext?: boolean) => void;

function renderRu(a: ReceiptAnswers, push: Push, bind: BindField): void {
  const amount = bind("loanAmountNumeric", formatNumericAmount(a.loanAmountNumeric, a.currency === "USD" && a.includeCents));
  const currency = a.currency === "UZS" ? "сум" : a.includeCents ? "долларов США и центов" : "долларов США";
  push("РАСПИСКА", "title", "title", true);
  push("в получении денежных средств", "subtitle", "subtitle", true);
  push(`Место составления: ${bind("documentPlace", value(a.documentPlace))}`);
  push(`Дата составления: ${bind("documentDate", date(a.documentDate, a.language))}`);
  push("Настоящая расписка составлена между:");
  push(ruParty(a.lender, "lender", bind));
  push("и");
  push(ruParty(a.borrower, "borrower", bind));

  push("1. Получение денежных средств", "heading", "section-1", true);
  push(`1.1. Заемщик настоящим подтверждает, что ${bind("loanTransferDate", date(a.loanTransferDate, a.language))} фактически получил от Займодавца в качестве займа денежные средства в размере:`);
  push(`${amount} ${currency} (${bind("loanAmountWords", value(a.loanAmountWords))}).`);
  push("1.2. Денежные средства переданы Заемщику следующим способом:");
  push(`${transferMethodText(a)}.`);
  push("Реквизиты или иные сведения, подтверждающие передачу денежных средств:");
  push(`${transferDetailsText(a, bind)}.`);
  push("1.3. Заемщик подтверждает, что денежные средства получены им полностью. Претензий к размеру, способу, сроку и обстоятельствам передачи денежных средств Заемщик не имеет.");
  push("1.4. Настоящая расписка одновременно подтверждает:");
  [
    "возникновение между Займодавцем и Заемщиком отношений по договору займа;",
    "фактическую передачу Займодавцем суммы займа;",
    "фактическое получение Заемщиком суммы займа;",
    "обязанность Заемщика возвратить полученную сумму на условиях настоящей расписки.",
  ].forEach((item, i) => push(item, "list", `section-1-list-${i}`));

  push("2. Срок и порядок возврата займа", "heading", "section-2", true);
  push("2.1. Заемщик обязуется полностью возвратить Займодавцу сумму займа не позднее:");
  push(`${bind("loanRepaymentDate", date(a.loanRepaymentDate, a.language))}.`);
  push("2.2. Возврат суммы займа осуществляется следующим способом:");
  push(`${repaymentMethodText(a)}.`);
  push("Реквизиты и дополнительные условия возврата:");
  repaymentDetailsText(a, bind).split("\n").forEach((line) => push(`${line}${line.endsWith(".") ? "" : "."}`));
  if (a.repayment.planType === "single") {
    push("2.3. Если стороны письменно не согласовали иное, сумма займа должна быть возвращена одним платежом в полном объёме.");
  } else {
    push("2.3. Сумма займа возвращается частями в соответствии с указанным выше графиком платежей.");
  }
  push("2.4. Частичный возврат суммы займа допускается только при условии, что каждый платёж подтверждается одним из следующих документов:");
  ["распиской Займодавца о получении соответствующей суммы;", "банковским платёжным документом;", "электронной квитанцией;", "иным письменным документом, позволяющим установить сумму, дату, плательщика и назначение платежа."].forEach((item, i) => push(item, "list", `section-2-list-${i}`));
  push("2.5. При безналичном переводе обязательство Заемщика считается исполненным в соответствующей части с момента зачисления денежных средств на банковский счёт или банковскую карту Займодавца.");
  push("2.6. При возврате наличными денежными средствами обязательство Заемщика считается исполненным в соответствующей части с момента получения Заемщиком подписанной Займодавцем расписки о принятии денежных средств.");
  push("2.7. Назначение безналичного платежа должно содержать указание:");
  push(`«Возврат займа по расписке от ${bind("documentDate", date(a.documentDate, a.language))}».`);

  push("3. Проценты за пользование займом", "heading", "section-3", true);
  push(`3.1. ${interestTermsText(a, bind)}`);
  if (a.interest.mode === "interest") {
    push("3.2. Проценты начисляются исключительно на фактически непогашенную сумму основного долга.");
    push("3.3. Если стороны не установили отдельный порядок уплаты процентов, начисленные проценты выплачиваются одновременно с возвратом основной суммы займа.");
  }
  push(`3.4. ${earlyRepaymentText(a, bind)}`);

  if (a.responsibilityMode !== "exclude") {
    push("4. Ответственность за нарушение срока возврата", "heading", "section-4", true);
    if (a.responsibilityMode === "custom") {
      a.responsibilityCustom.split(/\n+/).filter(Boolean).forEach((line, index) => push(`4.${index + 1}. ${line}`));
    } else {
      push("4.1. В случае невозврата или неполного возврата суммы займа в срок, установленный пунктом 2.1 настоящей расписки, Заемщик считается допустившим просрочку со дня, следующего за установленной датой возврата.");
      push("4.2. При просрочке возврата займа Займодавец вправе потребовать:");
      ["возврата непогашенной суммы основного долга;", "уплаты предусмотренных настоящей распиской процентов;", "уплаты процентов за неправомерное пользование чужими денежными средствами в порядке и размере, установленных законодательством Республики Узбекистан;", "возмещения убытков в предусмотренных законодательством случаях;", "возмещения судебных расходов в порядке, установленном процессуальным законодательством."].forEach((item, i) => push(item, "list", `section-4-list-${i}`));
      push("4.3. Принятие Займодавцем части просроченной задолженности не означает отказа от права требовать возврата оставшейся суммы долга, процентов и иных предусмотренных законодательством платежей.");
      push("4.4. Предоставление Заемщику дополнительного времени для исполнения обязательства не изменяет срок возврата займа, если стороны письменно не заключили соответствующее соглашение.");
    }
  }

  push("5. Подтверждения Заемщика", "heading", "section-5", true);
  push("5.1. Заемщик подтверждает, что на момент подписания настоящей расписки:");
  ["обладает полной гражданской дееспособностью;", "понимает юридическое значение своих действий;", "действует добровольно, без обмана, насилия, угрозы или давления;", "полностью понимает содержание настоящей расписки;", "получил денежные средства именно от указанного в расписке Займодавца;", "признаёт сумму займа и обязанность её возврата;", "указанные им персональные и идентификационные сведения являются достоверными."].forEach((item, i) => push(item, "list", `section-5-list-${i}`));
  push("5.2. Заемщик подтверждает отсутствие между сторонами иных устных договорённостей, противоречащих содержанию настоящей расписки.");
  if (a.noticesMode !== "exclude") push(`5.3. Заемщик обязуется письменно уведомить Займодавца об изменении места жительства, номера телефона или иных контактных данных не позднее ${bind("notificationPeriod", value(a.notificationPeriod))} календарных дней со дня соответствующего изменения.`);

  if (a.noticesMode !== "exclude") {
    push("6. Уведомления и требования", "heading", "section-6", true);
    if (a.noticesMode === "custom") {
      a.noticesCustom.split(/\n+/).filter(Boolean).forEach((line, index) => push(`6.${index + 1}. ${line}`));
    } else {
      push("6.1. Юридически значимые сообщения, требования и уведомления могут направляться:");
      ["заказным почтовым отправлением;", "курьерской доставкой;", "по электронной почте;", "через мессенджер;", "иным способом, позволяющим подтвердить отправление и содержание сообщения."].forEach((item, i) => push(item, "list", `section-6-list-${i}`));
      push(`6.2. Контактные данные Займодавца для направления уведомлений: ${value(a.lender.noticeDetails || [a.lender.phone, a.lender.email].filter(Boolean).join(", "))}.`);
      push(`6.3. Контактные данные Заемщика для направления уведомлений: ${value(a.borrower.noticeDetails || [a.borrower.phone, a.borrower.email].filter(Boolean).join(", "))}.`);
    }
  }

  push("7. Разрешение споров", "heading", "section-7", true);
  push("7.1. Стороны принимают разумные меры для урегулирования возникающих разногласий путём переговоров и письменного обмена требованиями.");
  push("7.2. Если спор не урегулирован добровольно, он подлежит рассмотрению соответствующим судом Республики Узбекистан согласно правилам подведомственности и подсудности, установленным законодательством.");

  push("8. Заключительные положения", "heading", "section-8", true);
  push("8.1. Изменения срока, размера, порядка возврата займа или иных условий действительны только при их письменном оформлении и подписании обеими сторонами.");
  push("8.2. Устные заявления и договорённости сторон не изменяют содержание настоящей расписки.");
  push("8.3. Недействительность отдельного положения настоящей расписки не влечёт недействительности остальных её положений.");
  push("8.4. Настоящая расписка составлена в двух экземплярах, имеющих одинаковое содержание: один экземпляр передаётся Займодавцу, второй — Заемщику.");
  push("8.5. Каждая страница расписки подписывается Заемщиком. Последняя страница подписывается обеими сторонами.");
  push("8.6. Содержание расписки сторонам понятно. Все внесённые сведения проверены сторонами до подписания.");
  if (a.additionalTerms.trim()) push(`8.7. Дополнительные условия: ${bind("additionalTerms", a.additionalTerms.trim())}`);

  push("9. Подписи сторон", "heading", "section-9", true);
  push("ЗАЕМЩИК", "subtitle", "borrower-signature-title", true);
  push(`Я, ${bind("borrower.fullName", value(a.borrower.fullName))}, подтверждаю, что получил(а) от ${bind("lender.fullName", value(a.lender.fullName))} денежные средства в размере:`);
  push(`${amount} ${currency} (${bind("loanAmountWords", value(a.loanAmountWords))}) полностью.`);
  push("Обязательство возвратить указанную сумму на условиях настоящей расписки признаю в полном объёме.");
  push("Собственноручная запись Заемщика:");
  push(`«Денежные средства в размере ${bind("loanAmountWords", value(a.loanAmountWords))} получил(а) полностью. Обязуюсь возвратить их не позднее ${bind("loanRepaymentDate", date(a.loanRepaymentDate, a.language))}».`);
  push("", "spacer");
  push(`Подпись: __________________ / ${bind("borrower.fullName", value(a.borrower.fullName))}`, "signature");
  push(`Дата подписания: ${bind("documentDate", date(a.documentDate, a.language))}`, "signature");
  push("", "spacer");
  push("ЗАЙМОДАВЕЦ", "subtitle", "lender-signature-title", true);
  push(`Я, ${bind("lender.fullName", value(a.lender.fullName))}, подтверждаю передачу Заемщику суммы займа, указанной в настоящей расписке.`);
  push("", "spacer");
  push(`Подпись: __________________ / ${bind("lender.fullName", value(a.lender.fullName))}`, "signature");
  push(`Дата подписания: ${bind("documentDate", date(a.documentDate, a.language))}`, "signature");

  if (a.hasWitnesses) {
    push("10. Свидетели", "heading", "section-10", true);
    a.witnesses.forEach((witness, index) => witnessText(witness, index + 1, a.language, bind).forEach((line) => push(line, "signature")));
  }
}

function renderUz(a: ReceiptAnswers, push: Push, bind: BindField): void {
  const amount = bind("loanAmountNumeric", formatNumericAmount(a.loanAmountNumeric, a.currency === "USD" && a.includeCents));
  const currency = a.currency === "UZS" ? "сўм" : a.includeCents ? "АҚШ доллари ва цент" : "АҚШ доллари";
  push("ТИЛХАТ", "title", "title", true);
  push("пул маблағларини олганлик тўғрисида", "subtitle", "subtitle", true);
  push(`Тузилган жой: ${bind("documentPlace", value(a.documentPlace))}`);
  push(`Тузилган сана: ${bind("documentDate", date(a.documentDate, a.language))}`);
  push("Ушбу тилхат қуйидагилар ўртасида тузилди:");
  push(uzParty(a.lender, "lender", bind));
  push("ва");
  push(uzParty(a.borrower, "borrower", bind));

  push("1. Пул маблағларини олиш", "heading", "section-1", true);
  push(`1.1. Қарз олувчи ${bind("loanTransferDate", date(a.loanTransferDate, a.language))} санасида Қарз берувчидан қарз сифатида қуйидаги миқдордаги пул маблағларини амалда олганлигини тасдиқлайди:`);
  push(`${amount} ${currency} (${bind("loanAmountWords", value(a.loanAmountWords))}).`);
  push("1.2. Пул маблағлари Қарз олувчига қуйидаги усулда топширилди:");
  push(`${transferMethodText(a)}.`);
  push("Пул маблағлари топширилганлигини тасдиқловчи реквизитлар ёки бошқа маълумотлар:");
  push(`${transferDetailsText(a, bind)}.`);
  push("1.3. Қарз олувчи пул маблағларини тўлиқ олганлигини тасдиқлайди. Қарз олувчининг пул маблағларининг миқдори, усули, муддати ва топшириш ҳолатлари бўйича эътирозлари мавжуд эмас.");
  push("1.4. Ушбу тилхат бир вақтнинг ўзида қуйидагиларни тасдиқлайди:");
  ["Қарз берувчи ва Қарз олувчи ўртасида қарз шартномаси бўйича муносабатлар вужудга келганлигини;", "Қарз берувчи қарз суммасини амалда топширганлигини;", "Қарз олувчи қарз суммасини амалда олганлигини;", "Қарз олувчи олинган суммани ушбу тилхат шартларида қайтариши шартлигини."].forEach((item, i) => push(item, "list", `section-1-list-${i}`));

  push("2. Қарзни қайтариш муддати ва тартиби", "heading", "section-2", true);
  push("2.1. Қарз олувчи қарз суммасини Қарз берувчига қуйидаги санадан кечиктирмай тўлиқ қайтариш мажбуриятини олади:");
  push(`${bind("loanRepaymentDate", date(a.loanRepaymentDate, a.language))}.`);
  push("2.2. Қарз суммаси қуйидаги усулда қайтарилади:");
  push(`${repaymentMethodText(a)}.`);
  push("Қайтариш реквизитлари ва қўшимча шартлари:");
  repaymentDetailsText(a, bind).split("\n").forEach((line) => push(`${line}${line.endsWith(".") ? "" : "."}`));
  push(a.repayment.planType === "single" ? "2.3. Агар тарафлар ёзма равишда бошқача келишмаган бўлса, қарз суммаси битта тўлов билан тўлиқ қайтарилиши керак." : "2.3. Қарз суммаси юқорида кўрсатилган тўловлар жадвалига мувофиқ қисмларга бўлиб қайтарилади.");
  push("2.4. Қарз суммасини қисман қайтаришга ҳар бир тўлов қуйидаги ҳужжатлардан бири билан тасдиқланган тақдирдагина йўл қўйилади:");
  ["Қарз берувчининг тегишли суммани олганлиги ҳақидаги тилхати;", "банк тўлов ҳужжати;", "электрон квитанция;", "тўлов суммаси, санаси, тўловчи ва тўлов мақсадини аниқлаш имконини берувчи бошқа ёзма ҳужжат."].forEach((item, i) => push(item, "list", `section-2-list-${i}`));
  push("2.5. Пул маблағлари нақд пулсиз ўтказилганда, Қарз олувчининг мажбурияти пул маблағлари Қарз берувчининг банк ҳисобварағига ёки банк картасига келиб тушган пайтдан бошлаб тегишли қисмда бажарилган ҳисобланади.");
  push("2.6. Пул маблағлари нақд шаклда қайтарилганда, Қарз олувчининг мажбурияти Қарз берувчи имзолаган пул маблағларини қабул қилганлик тўғрисидаги тилхат Қарз олувчига берилган пайтдан бошлаб тегишли қисмда бажарилган ҳисобланади.");
  push("2.7. Нақд пулсиз тўлов мақсадида қуйидаги кўрсатма бўлиши керак:");
  push(`«${bind("documentDate", date(a.documentDate, a.language))} санасидаги тилхат бўйича қарзни қайтариш».`);

  push("3. Қарздан фойдаланганлик учун фоизлар", "heading", "section-3", true);
  push(`3.1. ${interestTermsText(a, bind)}`);
  if (a.interest.mode === "interest") {
    push("3.2. Фоизлар фақат асосий қарзнинг амалда сўндирилмаган суммасига ҳисобланади.");
    push("3.3. Агар тарафлар фоизларни тўлашнинг алоҳида тартибини белгиламаган бўлса, ҳисобланган фоизлар асосий қарз суммаси қайтарилиши билан бир вақтда тўланади.");
  }
  push(`3.4. ${earlyRepaymentText(a, bind)}`);

  if (a.responsibilityMode !== "exclude") {
    push("4. Қайтариш муддати бузилганлиги учун жавобгарлик", "heading", "section-4", true);
    if (a.responsibilityMode === "custom") {
      a.responsibilityCustom.split(/\n+/).filter(Boolean).forEach((line, index) => push(`4.${index + 1}. ${line}`));
    } else {
      push("4.1. Қарз суммаси ушбу тилхатнинг 2.1-бандида белгиланган муддатда қайтарилмаган ёки тўлиқ қайтарилмаган тақдирда, Қарз олувчи белгиланган қайтариш санасидан кейинги кундан бошлаб кечиктиришга йўл қўйган ҳисобланади.");
      push("4.2. Қарзни қайтариш кечиктирилганда Қарз берувчи қуйидагиларни талаб қилишга ҳақли:");
      ["асосий қарзнинг сўндирилмаган суммасини қайтаришни;", "ушбу тилхатда назарда тутилган фоизларни тўлашни;", "Ўзбекистон Республикаси қонунчилигида белгиланган тартиб ва миқдорда ўзганинг пул маблағларидан ғайриқонуний фойдаланганлик учун фоизларни тўлашни;", "қонунчиликда назарда тутилган ҳолларда зарарларни қоплашни;", "процессуал қонунчиликда белгиланган тартибда суд харажатларини қоплашни."].forEach((item, i) => push(item, "list", `section-4-list-${i}`));
      push("4.3. Қарз берувчининг кечиктирилган қарзнинг бир қисмини қабул қилиши қолган қарз суммаси, фоизлар ва қонунчиликда назарда тутилган бошқа тўловларни талаб қилиш ҳуқуқидан воз кечишни англатмайди.");
      push("4.4. Қарз олувчига мажбуриятни бажариш учун қўшимча вақт берилиши, агар тарафлар тегишли ёзма келишув тузмаган бўлса, қарзни қайтариш муддатини ўзгартирмайди.");
    }
  }

  push("5. Қарз олувчининг тасдиқлари", "heading", "section-5", true);
  push("5.1. Қарз олувчи ушбу тилхат имзоланган пайтда қуйидагиларни тасдиқлайди:");
  ["тўлиқ фуқаролик муомала лаёқатига эга эканлигини;", "ўз ҳаракатларининг юридик аҳамиятини тушунишини;", "алдаш, зўравонлик, таҳдид ёки босимсиз, ихтиёрий ҳаракат қилишини;", "ушбу тилхат мазмунини тўлиқ тушунишини;", "пул маблағларини айнан тилхатда кўрсатилган Қарз берувчидан олганлигини;", "қарз суммаси ва уни қайтариш мажбуриятини тан олишини;", "у кўрсатган шахсий ва идентификация маълумотлари ишончли эканлигини."].forEach((item, i) => push(item, "list", `section-5-list-${i}`));
  push("5.2. Қарз олувчи тарафлар ўртасида ушбу тилхат мазмунига зид бўлган бошқа оғзаки келишувлар мавжуд эмаслигини тасдиқлайди.");
  if (a.noticesMode !== "exclude") push(`5.3. Қарз олувчи яшаш жойи, телефон рақами ёки бошқа алоқа маълумотлари ўзгарганлиги ҳақида Қарз берувчини тегишли ўзгариш содир бўлган кундан бошлаб ${bind("notificationPeriod", value(a.notificationPeriod))} календарь кундан кечиктирмай ёзма равишда хабардор қилиш мажбуриятини олади.`);

  if (a.noticesMode !== "exclude") {
    push("6. Хабарлар ва талаблар", "heading", "section-6", true);
    if (a.noticesMode === "custom") {
      a.noticesCustom.split(/\n+/).filter(Boolean).forEach((line, index) => push(`6.${index + 1}. ${line}`));
    } else {
      push("6.1. Юридик аҳамиятга эга хабарлар, талаблар ва билдиришномалар қуйидаги усулларда юборилиши мумкин:");
      ["буюртма почта жўнатмаси орқали;", "курьерлик етказиб бериш орқали;", "электрон почта орқали;", "мессенжер орқали;", "юборилганлик ва хабар мазмунини тасдиқлаш имконини берувчи бошқа усулда."].forEach((item, i) => push(item, "list", `section-6-list-${i}`));
      push(`6.2. Қарз берувчининг хабарлар юбориш учун алоқа маълумотлари: ${value(a.lender.noticeDetails || [a.lender.phone, a.lender.email].filter(Boolean).join(", "))}.`);
      push(`6.3. Қарз олувчининг хабарлар юбориш учун алоқа маълумотлари: ${value(a.borrower.noticeDetails || [a.borrower.phone, a.borrower.email].filter(Boolean).join(", "))}.`);
    }
  }

  push("7. Низоларни ҳал этиш", "heading", "section-7", true);
  push("7.1. Тарафлар юзага келган келишмовчиликларни музокаралар ва талабларни ёзма равишда алмашиш орқали ҳал қилиш учун оқилона чоралар кўрадилар.");
  push("7.2. Агар низо ихтиёрий равишда ҳал этилмаса, у қонунчиликда белгиланган тааллуқлилик ва судловга тегишлилик қоидаларига мувофиқ Ўзбекистон Республикасининг тегишли суди томонидан кўриб чиқилади.");

  push("8. Якуний қоидалар", "heading", "section-8", true);
  push("8.1. Қарзнинг муддати, миқдори, қайтариш тартиби ёки бошқа шартларига киритилган ўзгартиришлар фақат ёзма равишда расмийлаштирилиб, ҳар икки тараф томонидан имзоланган тақдирда ҳақиқий ҳисобланади.");
  push("8.2. Тарафларнинг оғзаки баёнотлари ва келишувлари ушбу тилхат мазмунини ўзгартирмайди.");
  push("8.3. Ушбу тилхатнинг алоҳида қоидаси ҳақиқий эмаслиги унинг бошқа қоидалари ҳақиқий эмаслигига олиб келмайди.");
  push("8.4. Ушбу тилхат бир хил мазмундаги икки нусхада тузилди: бир нусха Қарз берувчига, иккинчи нусха Қарз олувчига берилади.");
  push("8.5. Тилхатнинг ҳар бир саҳифаси Қарз олувчи томонидан имзоланади. Охирги саҳифа ҳар икки тараф томонидан имзоланади.");
  push("8.6. Тилхат мазмуни тарафларга тушунарли. Киритилган барча маълумотлар имзолашдан олдин тарафлар томонидан текширилган.");
  if (a.additionalTerms.trim()) push(`8.7. Қўшимча шартлар: ${bind("additionalTerms", a.additionalTerms.trim())}`);

  push("9. Тарафларнинг имзолари", "heading", "section-9", true);
  push("ҚАРЗ ОЛУВЧИ", "subtitle", "borrower-signature-title", true);
  push(`Мен, ${bind("borrower.fullName", value(a.borrower.fullName))}, ${bind("lender.fullName", value(a.lender.fullName))}дан қуйидаги миқдордаги пул маблағларини олганлигимни тасдиқлайман:`);
  push(`${amount} ${currency} (${bind("loanAmountWords", value(a.loanAmountWords))}) тўлиқ.`);
  push("Кўрсатилган суммани ушбу тилхат шартларида қайтариш мажбуриятини тўлиқ тан оламан.");
  push("Қарз олувчининг ўз қўли билан ёзадиган қайди:");
  push(`«${bind("loanAmountWords", value(a.loanAmountWords))} миқдоридаги пул маблағларини тўлиқ олдим. Уларни ${bind("loanRepaymentDate", date(a.loanRepaymentDate, a.language))} санасидан кечиктирмай қайтариш мажбуриятини оламан».`);
  push("", "spacer");
  push(`Имзо: __________________ / ${bind("borrower.fullName", value(a.borrower.fullName))}`, "signature");
  push(`Имзоланган сана: ${bind("documentDate", date(a.documentDate, a.language))}`, "signature");
  push("", "spacer");
  push("ҚАРЗ БЕРУВЧИ", "subtitle", "lender-signature-title", true);
  push(`Мен, ${bind("lender.fullName", value(a.lender.fullName))}, ушбу тилхатда кўрсатилган қарз суммасини Қарз олувчига топширганлигимни тасдиқлайман.`);
  push("", "spacer");
  push(`Имзо: __________________ / ${bind("lender.fullName", value(a.lender.fullName))}`, "signature");
  push(`Имзоланган сана: ${bind("documentDate", date(a.documentDate, a.language))}`, "signature");

  if (a.hasWitnesses) {
    push("10. Гувоҳлар", "heading", "section-10", true);
    a.witnesses.forEach((witness, index) => witnessText(witness, index + 1, a.language, bind).forEach((line) => push(line, "signature")));
  }
}

export function renderReceipt(answers: ReceiptAnswers, includeFields = false): RenderedReceipt {
  const paragraphs: RenderedParagraph[] = [];
  const fields: PreviewPart[] = [];
  // Keep links attached to the exact values emitted by this renderer in both languages.
  let separator = "\uE000";
  if (includeFields) {
    const input = JSON.stringify(answers);
    while (input.includes(separator)) separator += "\uE000";
  }
  const marker = new RegExp(separator + "(\\d+)" + separator, "g");
  const bind: BindField = includeFields ? (key, text) => {
    if (/[\r\n]/.test(text)) return text;
    const index = fields.push({ text, field: { key } }) - 1;
    return separator + index + separator + text;
  } : renderField;
  const push: Push = (text, kind = "body", id, keepWithNext) => {
    const paragraph = { id: id ?? `p-${paragraphs.length + 1}`, text, kind, keepWithNext };
    if (!includeFields) {
      paragraphs.push(paragraph);
      return;
    }
    const parts: PreviewPart[] = [];
    let end = 0;
    for (const match of text.matchAll(marker)) {
      const field = fields[Number(match[1])];
      if (!field) continue;
      if (match.index > end) parts.push({ text: text.slice(end, match.index) });
      parts.push(field);
      end = match.index + match[0].length + field.text.length;
    }
    if (parts.length) {
      if (end < text.length) parts.push({ text: text.slice(end) });
      paragraphs.push({ ...paragraph, parts, text: parts.map(part => part.text).join("") });
    } else {
      paragraphs.push(paragraph);
    }
  };
  if (answers.language === "uz-cyrl") renderUz(answers, push, bind);
  else renderRu(answers, push, bind);
  return {
    title: answers.language === "ru" ? "Расписка в получении денежных средств" : "Пул маблағларини олганлик тўғрисида тилхат",
    paragraphs,
    plainText: paragraphs.map((paragraph) => paragraph.text).join("\n\n"),
  };
}

export function suggestedDocumentTitle(answers: ReceiptAnswers): string {
  const dateValue = date(answers.documentDate, answers.language);
  return answers.language === "ru"
    ? `Расписка в получении денежных средств — ${dateValue}`
    : `Пул маблағларини олганлик тўғрисида тилхат — ${dateValue}`;
}
