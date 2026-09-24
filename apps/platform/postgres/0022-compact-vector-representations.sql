-- A verified generic generation is not sufficient for half-precision cosine
-- search if its representatives overflow or all coordinates round to zero.
CREATE FUNCTION storage.validate_compact_vector_generation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM storage.vector_collections
    WHERE name=NEW.collection AND dimensions=1536 AND metric='cosine') THEN
    -- The casts reject out-of-range finite originals. The dot product rejects
    -- zero converted vectors without normalizing or modifying stored values.
    IF EXISTS(SELECT 1 FROM storage.vector_search_groups g WHERE g.generation_id=NEW.id
      AND (g.embedding::halfvec(1536) <#> g.embedding::halfvec(1536))=0) THEN
      RAISE EXCEPTION 'VECTOR_GENERATION_HALF_PRECISION_ZERO';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vector_generation_representation BEFORE UPDATE ON storage.vector_search_generations
  FOR EACH ROW WHEN (OLD.state='building' AND NEW.state='verified')
  EXECUTE FUNCTION storage.validate_compact_vector_generation();

DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM storage.vector_search_groups g
    JOIN storage.vector_search_generations p ON p.id=g.generation_id
    JOIN storage.vector_collections c ON c.name=p.collection
    WHERE p.state='verified' AND CASE WHEN c.dimensions=1536 AND c.metric='cosine'
      THEN (g.embedding::halfvec(1536) <#> g.embedding::halfvec(1536))=0 ELSE false END) THEN
    RAISE EXCEPTION 'VECTOR_GENERATION_HALF_PRECISION_ZERO';
  END IF;
END;
$$;
