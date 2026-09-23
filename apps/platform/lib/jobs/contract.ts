export const JOB_KINDS = [
  "document.analyze",
  "document.index",
  "ocr.process",
  "document.export",
  "email.send",
  "legal.sync",
  "legal.parse",
  "legal.index",
  "cleanup.run",
  "notification.dispatch",
  "malware.scan",
] as const;

type JobKind = (typeof JOB_KINDS)[number];

const queueStemByKind: Record<JobKind, string> = {
  "document.analyze": "document-analysis",
  "document.index": "document-analysis",
  "ocr.process": "ocr-processing",
  "document.export": "document-export",
  "email.send": "email-notifications",
  "legal.sync": "legal-sources-sync",
  "legal.parse": "legal-sources-sync",
  "legal.index": "legal-sources-sync",
  "cleanup.run": "data-retention-cleanup",
  "notification.dispatch": "notifications",
  "malware.scan": "malware-scan",
};

export const QUEUE_BINDING_BY_KIND = {
  "document.analyze": "DOCUMENT_ANALYSIS_QUEUE",
  "document.index": "DOCUMENT_ANALYSIS_QUEUE",
  "ocr.process": "OCR_PROCESSING_QUEUE",
  "document.export": "DOCUMENT_EXPORT_QUEUE",
  "email.send": "EMAIL_NOTIFICATIONS_QUEUE",
  "legal.sync": "LEGAL_SOURCES_SYNC_QUEUE",
  "legal.parse": "LEGAL_SOURCES_SYNC_QUEUE",
  "legal.index": "LEGAL_SOURCES_SYNC_QUEUE",
  "cleanup.run": "DATA_RETENTION_CLEANUP_QUEUE",
  "notification.dispatch": "NOTIFICATIONS_QUEUE",
  "malware.scan": "MALWARE_SCAN_QUEUE",
} as const satisfies Record<JobKind, string>;

export function expectedQueueName(
  kind: JobKind,
  environment: string,
): string {
  const stem = queueStemByKind[kind];
  if (!stem) {
    throw new TypeError("Unsupported job kind.");
  }
  return `${environment}-${stem}`;
}

