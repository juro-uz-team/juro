ALTER TABLE app.document_files ADD COLUMN tool_source_document_id text;
CREATE INDEX document_files_tool_source_document_idx ON app.document_files (workspace_id, owner_user_id, tool_source_document_id);
CREATE INDEX document_files_tool_input_hash_idx ON app.document_files (workspace_id, owner_user_id, sha256) WHERE sha256 IS NOT NULL;
ALTER TABLE app.document_analyses ADD COLUMN progress_stage text;
