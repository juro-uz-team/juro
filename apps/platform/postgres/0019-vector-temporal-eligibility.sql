CREATE INDEX embeddings_temporal_eligibility_idx ON storage.embeddings
  (collection,(metadata #> '{valid_to_epoch}'),(metadata #> '{valid_from_epoch}'))
  INCLUDE(id);
