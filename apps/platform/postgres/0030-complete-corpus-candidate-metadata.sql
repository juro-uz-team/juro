-- Preserve the candidate-only read path for independently rebuilt corpus
-- collections. Original vector values remain in the authoritative heap.
CREATE INDEX embeddings_complete_corpus_candidate_metadata
  ON storage.embeddings(collection,id) INCLUDE(namespace,metadata)
  WHERE collection IN (
    'juro-legal-current-complete-20260925',
    'juro-legal-history-complete-20260925'
  );
