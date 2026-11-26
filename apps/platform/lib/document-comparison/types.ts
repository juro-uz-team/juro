export type ComparisonLocale = "ru" | "uz" | "en";

export type ComparisonStage =
  | "uploaded"
  | "extracting_version_one"
  | "extracting_version_two"
  | "structuring"
  | "diffing"
  | "legal_analysis"
  | "completed"
  | "failed";

export type ComparisonStatus =
  | "queued"
  | "processing"
  | "completed"
  | "completed_partial"
  | "failed"
  | "deleted";

export type ChangeType =
  | "added"
  | "removed"
  | "changed"
  | "moved"
  | "renumbered"
  | "formatting"
  | "unchanged";

export type RiskEffect =
  | "increased"
  | "decreased"
  | "neutral"
  | "requires_review"
  | "insufficient_data";

export type RiskLevel = "high" | "medium" | "low" | "information";

export type TextQuality = "good" | "limited" | "ocr_required";

export type ExtractedSection = {
  id: string;
  index: number;
  label: string | null;
  heading: string | null;
  text: string;
  normalizedText: string;
  semanticText: string;
};

export type AnalysisPackageMemberRole =
  | "primary"
  | "annex"
  | "amendment"
  | "acceptance_act"
  | "correspondence"
  | "evidence"
  | "unknown";

export type AnalysisPackageRelationshipKind =
  | "annex_to"
  | "amends"
  | "acceptance_for"
  | "supports"
  | "references"
  | "possible_duplicate";

export type AnalysisPackageMemberContext = {
  id: string;
  name: string;
  mimeType: string;
  role: AnalysisPackageMemberRole;
  detectedLanguage: ExtractedDocument["detectedLanguage"];
  pageCount: number | null;
  sectionCount: number;
};

export type AnalysisPackageRelationship = {
  fromMemberId: string;
  toMemberId: string;
  kind: AnalysisPackageRelationshipKind;
  confidence: "high" | "medium" | "low";
  evidence: string[];
};

export type AnalysisPackageContext = {
  schemaVersion: 1;
  primaryMemberId: string | null;
  members: AnalysisPackageMemberContext[];
  relationships: AnalysisPackageRelationship[];
};

export type ExtractedDocument = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  detectedLanguage: "ru" | "uz" | "mixed" | "unknown";
  textQuality: TextQuality;
  warningCode: string | null;
  text: string;
  sections: ExtractedSection[];
  packageContext?: AnalysisPackageContext | null;
};

export type WordDiffPart = {
  value: string;
  kind: "same" | "added" | "removed";
};

export type ComparisonChange = {
  id: string;
  ordinal: number;
  changeType: ChangeType;
  beforeSectionId: string | null;
  afterSectionId: string | null;
  beforeLabel: string | null;
  afterLabel: string | null;
  beforeHeading: string | null;
  afterHeading: string | null;
  beforeText: string | null;
  afterText: string | null;
  wordDiff: WordDiffPart[];
  summary: string;
  legalEffect: string;
  affectedParty: string;
  riskEffect: RiskEffect;
  riskLevel: RiskLevel;
  recommendation: string;
  sourceIds: string[];
  confidencePercent: number | null;
  reviewedAt: string | null;
  reviewDecision: "accepted" | "rejected" | null;
  decidedAt: string | null;
  reviewDecisionVersion: number;
  extractionWarning: boolean;
};

export type ComparisonSummary = {
  sources?: import("./storage").VerifiedLegalSource[];
  legalResearchScope?: "document" | "changes";
  totalChanges: number;
  materialChanges: number;
  riskIncreased: number;
  riskDecreased: number;
  added: number;
  removed: number;
  changed: number;
  moved: number;
  renumbered: number;
  formatting: number;
  unchanged: number;
  changedSections: string[];
  similarityPercent: number;
  likelyDifferentDocuments: boolean;
  overallRisk: RiskLevel;
  aiStatus: "completed" | "unavailable" | "not_required" | "failed";
  sourceStatus: "verified" | "partial" | "unverified";
  model: string | null;
  generatedAt: string;
};

export type ComparisonResult = {
  versionOne: ExtractedDocument;
  versionTwo: ExtractedDocument;
  changes: ComparisonChange[];
  summary: ComparisonSummary;
};

export class ComparisonProcessingError extends Error {
  constructor(
    readonly code:
      | "CORRUPT_FILE"
      | "FILE_SCAN_REQUIRED"
      | "PASSWORD_PROTECTED"
      | "NO_READABLE_TEXT"
      | "OCR_REQUIRED"
      | "PAGE_LIMIT_EXCEEDED"
      | "PROCESSING_TIMEOUT"
      | "UNSUPPORTED_FILE",
    message: string,
  ) {
    super(message);
    this.name = "ComparisonProcessingError";
  }
}
