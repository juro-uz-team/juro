export type RegistryLanguage = "ru" | "uz" | "uz-cyrl" | "en";

export interface LocalizedText {
  ru: string;
  uz: string;
  "uz-cyrl"?: string;
  en?: string;
}

export type PublicationStatus = "draft" | "review" | "published" | "archived";
export type EditorialStatus =
  | "Draft"
  | "Legal Review"
  | "Translation Review"
  | "Technical Review"
  | "Published"
  | "Archived";

export type QuestionnaireFieldType =
  | "short-text"
  | "long-text"
  | "full-name"
  | "pinfl"
  | "passport"
  | "company-name"
  | "tin"
  | "bank-details"
  | "address"
  | "phone"
  | "email"
  | "date"
  | "duration"
  | "money"
  | "currency"
  | "percent"
  | "number"
  | "radio"
  | "checkbox"
  | "select"
  | "multiselect"
  | "table"
  | "repeatable-group"
  | "file"
  | "party-natural-person"
  | "party-legal-entity"
  | "representative"
  | "witnesses"
  | "clause-choice";

export type AnswerScalar = string | number | boolean;
export type AnswerValue = AnswerScalar | AnswerScalar[] | Record<string, AnswerScalar>[];
export type QuestionnaireAnswers = Record<string, AnswerValue>;

export interface FieldOption {
  value: string;
  label: LocalizedText;
}

export interface FieldCondition {
  field: string;
  operator: "equals" | "not-equals" | "includes" | "truthy" | "falsy" | "filled" | "empty";
  value?: AnswerScalar;
}

export interface QuestionnaireField {
  id: string;
  type: QuestionnaireFieldType;
  label: LocalizedText;
  help?: LocalizedText;
  placeholder?: LocalizedText;
  required?: boolean;
  options?: FieldOption[];
  condition?: FieldCondition;
  validation?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    pattern?: string;
    message?: LocalizedText;
  };
  columns?: QuestionnaireField[];
  fields?: QuestionnaireField[];
  reusableBlock?: string;
}

export interface QuestionnaireStep {
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  fields: QuestionnaireField[];
}

export interface GenerationParagraph {
  id: string;
  kind: "title" | "subtitle" | "heading" | "body" | "list" | "signature" | "spacer";
  text: LocalizedText;
  condition?: FieldCondition;
  repeatFor?: string;
}

export interface GenerationSchema {
  fileName: LocalizedText;
  paragraphs: GenerationParagraph[];
}

export type ParticipantRole =
  | "owner"
  | "creator"
  | "party"
  | "counterparty"
  | "co-party"
  | "representative"
  | "editor"
  | "commenter"
  | "viewer"
  | "legal-reviewer"
  | "approver";

export type DocumentPermission =
  | "view_document"
  | "edit_assigned_fields"
  | "edit_all_fields"
  | "add_comment"
  | "reply_comment"
  | "resolve_comment"
  | "create_suggestion"
  | "accept_suggestion"
  | "reject_suggestion"
  | "invite_participant"
  | "revoke_participant"
  | "approve_document"
  | "generate_document"
  | "download_document"
  | "archive_document"
  | "view_audit_history";

export interface PartyFieldAssignment {
  partyNumber: number;
  fieldPrefixes: string[];
}

export interface CollaborationDefinition {
  enabled: boolean;
  minimumParties: number;
  maximumParties?: number;
  supportedRoles: ParticipantRole[];
  allowComments: boolean;
  allowSuggestions: boolean;
  allowDirectEditing: boolean;
  allowMentions: boolean;
  allowApprovals: boolean;
  requireAllRequiredPartiesApproval?: boolean;
  blockGenerationOnUnresolvedComments?: boolean;
  partyFieldAssignments?: PartyFieldAssignment[];
}

export interface DocumentSourceReference {
  source: "juro" | "yurxizmat" | "legislation" | "legal_review";
  url?: string;
  reviewedAt: string;
  note?: string;
}

export interface DocumentDefinition {
  allowedPlans?: string[];
  id: string;
  code: string;
  categoryCode: string;
  subcategoryCode: string;
  documentCode: string;
  slug: string;
  categorySlug: string;
  titleRu: string;
  titleUz: string;
  descriptionRu: string;
  descriptionUz: string;
  legalBasisRu?: string[];
  legalBasisUz?: string[];
  legalDisclaimerRu?: string;
  legalDisclaimerUz?: string;
  status: PublicationStatus;
  editorialStatus: EditorialStatus;
  version: string;
  estimatedMinutes?: number;
  questionnaire: QuestionnaireStep[];
  generationSchema: GenerationSchema;
  collaboration: CollaborationDefinition;
  legacyPaths?: string[];
  sourceReferences?: DocumentSourceReference[];
  specialBuilder?: "receipt";
  updatedAt: string;
  sourceCategory?: string;
  sourceOrder?: number;
  duplicateOf?: string;
  popular?: boolean;
}

export interface DocumentCategory {
  code: string;
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  icon: string;
}

export type DocumentLibraryItem = Pick<DocumentDefinition,
  "code" | "categorySlug" | "titleRu" | "titleUz" | "descriptionRu" | "descriptionUz" |
  "status" | "editorialStatus" | "estimatedMinutes" | "popular"
>;

export interface RegistryValidationResult {
  valid: boolean;
  duplicateCodes: string[];
  duplicateRoutes: string[];
  invalidCodes: string[];
  missingRuTitles: string[];
  missingUzTitles: string[];
}
