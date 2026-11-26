export type DocumentLanguage = "ru" | "uz" | "uz-cyrl";
export type ParticipantMode = "self" | "for_other" | "organization";
export type ActingSide = "lender" | "borrower" | "both" | "organization";
export type IdentityDocumentType = "passport" | "id_card" | "";
export type Currency = "UZS" | "USD";
export type TransferMethod = "cash" | "bank" | "card" | "other";
export type RepaymentPlanType = "single" | "schedule";
export type InterestMode = "interest" | "interest_free" | "other";
export type InterestPeriod = "month" | "year" | "other";
export type InterestPaymentOrder = "with_principal" | "monthly" | "other";
export type EarlyRepaymentMode = "allow" | "deny" | "conditional";
export type ConditionalSectionMode = "standard" | "exclude" | "custom";
export type DocumentStatus = "Черновик" | "Готов" | "Согласован" | "Подписан" | "Архив";
export type RiskLevel = "critical" | "recommended" | "optional";

export interface PartyDetails {
  fullName: string;
  birthDate: string;
  idDocumentType: IdentityDocumentType;
  idDocumentNumber: string;
  idIssuedBy: string;
  idIssueDate: string;
  pinfl: string;
  registeredAddress: string;
  phone: string;
  email: string;
  noticeDetails: string;
  contactId?: string;
}

export interface WitnessDetails extends Omit<PartyDetails, "email" | "noticeDetails" | "idIssuedBy" | "idIssueDate"> {
  id: string;
}

export interface TransferDetails {
  method: TransferMethod;
  date: string;
  place: string;
  witnessesPresent: boolean;
  bankName: string;
  accountNumber: string;
  paymentReference: string;
  senderCardLast4: string;
  recipientCardLast4: string;
  time: string;
  transferredAmount: string;
  transactionNumber: string;
  otherMethodName: string;
  channel: string;
  confirmationDetails: string;
  comment: string;
}

export interface RepaymentDetails {
  planType: RepaymentPlanType;
  date: string;
  method: TransferMethod;
  place: string;
  bankName: string;
  accountNumber: string;
  paymentReference: string;
  senderCardLast4: string;
  recipientCardLast4: string;
  transactionNumber: string;
  otherDetails: string;
  comment: string;
  schedule: RepaymentScheduleItem[];
}

export interface RepaymentScheduleItem {
  id: string;
  date: string;
  amount: string;
  method: TransferMethod;
  comment: string;
}

export interface InterestDetails {
  mode: InterestMode;
  rate: string;
  period: InterestPeriod;
  customPeriod: string;
  paymentOrder: InterestPaymentOrder;
  customPaymentOrder: string;
  additionalTerms: string;
  otherTerms: string;
}

export interface ReceiptAnswers {
  language: DocumentLanguage;
  participantMode: ParticipantMode;
  actingSide: ActingSide;
  documentPlace: string;
  documentDate: string;
  lender: PartyDetails;
  borrower: PartyDetails;
  loanTransferDate: string;
  loanAmountNumeric: string;
  loanAmountWords: string;
  loanAmountWordsManuallyEdited: boolean;
  currency: Currency;
  includeCents: boolean;
  loanRepaymentDate: string;
  interest: InterestDetails;
  transfer: TransferDetails;
  repayment: RepaymentDetails;
  earlyRepaymentMode: EarlyRepaymentMode;
  earlyRepaymentCustom: string;
  responsibilityMode: ConditionalSectionMode;
  responsibilityCustom: string;
  noticesMode: ConditionalSectionMode;
  noticesCustom: string;
  notificationPeriod: string;
  hasWitnesses: boolean;
  witnesses: WitnessDetails[];
  additionalTerms: string;
  accuracyConfirmed: boolean;
}

export type PreviewFieldRef = { key: string; row?: { group: string; index: number } };
export type PreviewPart = { text: string; field?: PreviewFieldRef };

export interface RenderedParagraph {
  id: string;
  text: string;
  kind: "title" | "subtitle" | "heading" | "body" | "list" | "signature" | "spacer";
  keepWithNext?: boolean;
  reviewMark?: "deleted" | "inserted";
  parts?: PreviewPart[];
}

export interface RenderedReceipt {
  title: string;
  paragraphs: RenderedParagraph[];
  plainText: string;
}

export interface ValidationIssue {
  id: string;
  level: RiskLevel;
  title: string;
  message: string;
  field?: string;
  anchor?: string;
  originalText?: string;
  proposedText?: string;
  patch?: {
    type: "set-answer" | "replace-final-text";
    path?: string;
    value: string;
  };
  source: "deterministic" | "ai";
}

export interface QualityScore {
  legalCompleteness: number;
  dataCompleteness: number;
  riskLevel: "Высокий" | "Средний" | "Низкий";
  partyProtection: "Низкая" | "Средняя" | "Высокая";
  explanation: string[];
}

export interface AiReviewResult {
  status: "completed" | "unavailable";
  message?: string;
  issues: ValidationIssue[];
  quality: QualityScore;
  reviewedAt: string;
}

export interface DocumentRecord {
  id: string;
  templateId?: string;
  templateCode?: string | null;
  templateVersion?: string | null;
  title: string;
  category: string;
  status: DocumentStatus;
  caseId?: string | null;
  caseLinkRevision?: number;
  language: DocumentLanguage;
  lenderName: string | null;
  borrowerName: string | null;
  isFavorite: boolean;
  archivedAt: string | null;
  generatedAt: string | null;
  signedFileId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  accessRole?: "owner" | "collaborator";
}

export interface StoredDocument extends DocumentRecord {
  ownerUserId: string;
  answers: ReceiptAnswers;
  autoContent: string;
  finalContent: string;
  manuallyEdited: boolean;
}

export interface GenericStoredDocument extends DocumentRecord {
  ownerUserId: string;
  templateId: string;
  templateCode: string;
  templateVersion: string;
  answers: import("./registry/types").QuestionnaireAnswers;
  autoContent: string;
  finalContent: string;
  manuallyEdited: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  birthDate: string | null;
  idDocumentType: IdentityDocumentType | null;
  idDocumentNumber: string | null;
  idIssuedBy: string | null;
  idIssueDate: string | null;
  pinfl: string | null;
  registeredAddress: string | null;
  phone: string | null;
}

export interface ContactRecord {
  id: string;
  label: string;
  fullName: string;
  birthDate: string | null;
  idDocumentType: IdentityDocumentType | null;
  idDocumentNumber: string | null;
  idIssuedBy: string | null;
  idIssueDate: string | null;
  pinfl: string | null;
  registeredAddress: string | null;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileRecord {
  id: string;
  documentId: string | null;
  kind: "docx" | "pdf" | "zip" | "signed_pdf" | "standalone_signed_pdf" | "attachment";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  archivedAt: string | null;
  createdAt: string;
}

export interface NotificationRecord {
  id: string;
  documentId: string | null;
  type: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export interface CollaborationSnapshot {
  collaborators: Array<{
    id: string;
    userId: string;
    email: string;
    displayName: string;
    status: string;
    role?: string;
    partyNumber?: number | null;
    approvalStatus?: string;
    confirmedAt: string | null;
    signedViewAllowed?: boolean;
    signedDownloadAllowed?: boolean;
    signedOpened?: boolean;
    restoredViewOnly?: boolean;
  }>;
  comments: Array<{
    id: string;
    authorUserId: string;
    authorName: string;
    body: string;
    anchor: string | null;
    threadId?: string | null;
    parentCommentId?: string | null;
    threadStatus?: string | null;
    anchorType?: string | null;
    anchorKey?: string | null;
    createdAt: string;
  }>;
  proposals: Array<{
    id: string;
    authorUserId: string;
    oldText: string;
    newText: string;
    anchor: string | null;
    ownerAccepted: boolean;
    collaboratorAccepted: boolean;
    status: string;
    createdAt: string;
  }>;
  activity: Array<{
    id: string;
    type: string;
    createdAt: string;
  }>;
}
