ALTER TABLE app.file_extractions DROP CONSTRAINT file_extractions_method_check;
ALTER TABLE app.file_extractions ADD CONSTRAINT file_extractions_method_check
  CHECK (method IN ('workers_ai_markdown','local_document_conversion'));
