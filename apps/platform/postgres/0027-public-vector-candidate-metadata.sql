-- Compact graph expansion scores group representatives, so ordinary candidate
-- reads need identities and metadata, not the large original vector heap.
-- Limit this covering index to the retained public releases; private document
-- metadata keeps its existing storage and size contract.
CREATE INDEX embeddings_public_candidate_metadata
  ON storage.embeddings(collection,id) INCLUDE(namespace,metadata)
  WHERE collection IN (
    'juro-legal-current-custom-production-20260908',
    'juro-legal-history-custom-20260906'
  );
