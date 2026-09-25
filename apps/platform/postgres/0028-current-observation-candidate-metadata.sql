-- Refreshed current observations are an independent collection. Preserve the
-- original public-release indexes while allowing metadata-only candidate reads
-- to avoid fetching the new collection's original vector heap.
CREATE INDEX embeddings_current_observation_candidate_metadata
  ON storage.embeddings(collection,id) INCLUDE(namespace,metadata)
  WHERE collection='juro-legal-current-refreshed-20260924';
