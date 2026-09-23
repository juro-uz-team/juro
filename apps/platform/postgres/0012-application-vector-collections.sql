INSERT INTO storage.vector_collections(name,dimensions,metric,model)
VALUES ('lex',1536,'cosine','text-embedding-3-large'),
       ('advice',1536,'cosine','text-embedding-3-large'),
       ('user-documents',1536,'cosine','text-embedding-3-large')
ON CONFLICT(name) DO NOTHING;
