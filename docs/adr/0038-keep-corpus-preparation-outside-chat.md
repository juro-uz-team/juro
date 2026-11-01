# Keep corpus preparation outside chat

Legal chat consumes the prepared Indexed Official Corpus and delegates source acquisition, extraction, normalization, edition preparation, and freshness maintenance to a separate corpus lifecycle; it does not perform those operations during an answer. Chat uses stored complete provisions and their existing provenance for research and citations, keeping source preparation off the request path. The separate corpus update workflow is deferred; this decision supersedes earlier chat requirements for request-time publisher refresh or source preparation, without asserting that every retained corpus entry is already usable or weakening material-completeness requirements.

If bounded searches within the corpus cannot resolve missing material evidence, chat returns an explicit insufficient-evidence outcome rather than fetching publishers or supplying law from model memory.
