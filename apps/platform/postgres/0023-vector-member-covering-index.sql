-- Duplicate expansion needs only original identities. Keep them in the group
-- index so a verified generation does not read scattered member heap pages.
CREATE INDEX vector_search_members_identity
  ON storage.vector_search_members(generation_id,digest) INCLUDE(id);
