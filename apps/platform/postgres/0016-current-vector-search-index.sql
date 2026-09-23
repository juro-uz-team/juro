SET LOCAL maintenance_work_mem = '2GB';
SET LOCAL max_parallel_maintenance_workers = 0;
CREATE INDEX embeddings_current_cosine_idx ON storage.embeddings
USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
WITH (m=16,ef_construction=128)
WHERE collection='juro-legal-current-custom-production-20260908';
