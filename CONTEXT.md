# JURO Legal Intelligence

JURO helps people obtain source-grounded explanations of Uzbekistan law and turn those explanations into practical next steps.

## Language

### Answer structure

**Legal Answer**:
A structured, source-grounded response to a legal question, led by the Main Point and followed by What the Law Says and What to Do Next. Supporting sections appear only when they contain relevant information.
_Avoid_: AI response, generated text, chat completion

**Main Point**:
The concise, plain-language conclusion that leads every substantive Legal Answer with the applicable ordinary governing rule, followed by any material supported qualification.
_Avoid_: summary, short answer, abstract

**What the Law Says**:
The part of a Legal Answer that connects each applicable legal proposition to validated official evidence.
_Avoid_: model reasoning, general legal knowledge, references

**What to Do Next**:
The ordered practical guidance that follows from the supported legal analysis.
_Avoid_: action-plan upsell, recommendations panel, suggested prompts

**Qualified Rule**:
A source-grounded legal proposition together with the actors, conditions, exceptions and temporal qualifications that determine its meaning. Its explanation and practical application share that meaning without requiring identical wording across answer sections.
_Avoid_: answer template, keyword match, isolated entitlement

**Supporting Sections**:
Relevant qualifications presented separately as Important Considerations, Deadlines, What to Prepare, or Additional Materials; empty sections are absent.
_Avoid_: additional details, miscellaneous information

**Conditional Answer**:
A Legal Answer that presents separately supported outcomes for unresolved facts and asks only for information that would materially change the result.
_Avoid_: assumption, best guess, generic disclaimer

**Insufficient-Evidence Result**:
A dedicated non-answer identifying any relevant official provisions that were found, stating what was checked and what evidence is missing, and asking only the focused questions or next actions that could make a supported Legal Answer possible.
_Avoid_: uncertain answer, likely answer, empty Legal Answer

**Supported Partial Answer**:
A Legal Answer that answers the supported parts of a question, explicitly identifies unresolved parts, and asks only for information that could materially change the result. It does not present unresolved legal propositions as conclusions.
_Avoid_: complete answer, best guess, degraded success

**Legal Risk**:
A relevant adverse consequence or exposure explained with its severity and supporting evidence in the Important Considerations of a Legal Answer.
_Avoid_: generic disclaimer, model confidence, source unavailability

**Citation**:
The visible connection between a legal proposition and the validated source evidence that supports it.
_Avoid_: source link, bibliography entry, model reference

**Official Citation**:
A Citation to official-source material rendered with a provision label, publisher, captured revision and validated provision-specific Lex.uz URL, falling back to the validated document URL when necessary. It does not imply controlling-text or translation status.
_Avoid_: model-authored link, generated anchor, bare article number

**Citation Evidence Receipt**:
The retained identity of the exact official evidence used by a Citation, including its language and captured revision. It permits the cited text to be checked again without substituting a later revision.
_Avoid_: current article, saved legal text, answer cache

### Authority and evidence

**Controlling Text**:
Legacy audit evidence for a certified or adopted state-language expression that prevails when another-language rendering conflicts with it. It is optional enrichment, never inferred from a Lex.uz route, language code, source grouping or publication, and is not a Retrieval Eligibility gate.
_Avoid_: preferred translation, default language, newest script

**Official Translation**:
Legacy audit evidence for a non-controlling rendering whose relationship was explicitly supplied by an official source. Publication in another language does not establish this relationship; it is optional enrichment and is not a Retrieval Eligibility gate.
_Avoid_: equivalent law, controlling variant, localized original

### Question context

**Case Fact**:
A user-supplied or case-specific circumstance that may be confirmed or rejected and can change the Legal Answer.
_Avoid_: legal proposition, Citation, source-freshness state

### Official corpus

**Indexed Official Corpus**:
JURO's integrity-verified and indexed collection of public official-source snapshots eligible for a named retrieval capability, searched before any online source.
_Avoid_: knowledge base, local data, internal search

**Sparse Candidate Lane**:
The required lexical-retrieval channel that ranks official-corpus candidates by agreement with the question's normalized legal terms and structural fields.
_Avoid_: database search, exact lookup, dense fallback

**Dense Candidate Lane**:
The required semantic-retrieval channel that ranks official-corpus candidates by meaning across the question and eligible source representations.
_Avoid_: AI answer, semantic evidence, sparse fallback

**Hybrid Candidate Fusion**:
The deterministic combination of independent Sparse Candidate Lane and Dense Candidate Lane rankings into one candidate ordering before evidence validation and Provision Set selection. It does not make provider scores comparable or turn candidates into evidence.
_Avoid_: blended evidence, model reranking, coverage decision

**Candidate Packet**:
The request-scoped output of every candidate lane declared by one pinned Search Release for one Temporal Scope, containing stable locators, channel ranks and availability state but no legal conclusion or evidence. A partial packet is unavailable rather than a degraded search result.
_Avoid_: search results, evidence packet, partial answer

**Indexed Retrieval**:
The research step that searches the Indexed Official Corpus through every required candidate lane, validates candidate identities and eligibility, and reads verified source evidence for the interpreted question. It ends before Legal Answer generation and may yield Source Unavailability rather than usable evidence.
_Avoid_: vector query, complete Legal Answer, answer accuracy

**Retrieval Eligibility**:
The deterministic, capability-specific state derived from verified official-source provenance, exact catalog and evidence-object integrity, supported extraction and stable identities, a verified current pointer when required, supported temporal state, public privacy classification, quarantine clearance, and conflict-free canonicalization. Textual authority and translation relationships are not inputs.
_Avoid_: human approval, model confidence, indexed status

**Source Document**:
A stable identity assigned by an official publisher to one published document in one language/script. Different publisher document identities are not grouped merely because content or titles resemble one another.
_Avoid_: Legal Instrument, inferred language family, translated copy

**Source Snapshot**:
An immutable capture of a Source Document identified by publisher revision token, language, capture identity, content hash, capture time, and exact raw/normalized evidence objects.
_Avoid_: current pointer, mutable page, inferred Text Revision

**Snapshot Provision**:
An exact deterministic provision or fragment extracted from one Source Snapshot, retaining its publisher position token, sequence, normalized-content hash, source locator, provenance, privacy and temporal state.
_Avoid_: Provision Concept, search result, authority claim

**Retrieval Chunk**:
A deterministic bounded candidate unit derived from exactly one Snapshot Provision, retaining stable parent identity and order so retrieval can rank small passages without replacing the provision as the evidence boundary.
_Avoid_: Snapshot Provision, provider chunk, evidence excerpt

**Legal Instrument**:
An optional legacy cross-source/cross-language grouping preserved for audit and later evidence-backed enrichment. It is not inferred and does not gate current retrieval.
_Avoid_: Lex.uz page, language variant, document version

**Official Expression**:
An immutable legacy source identity with preserved textual-authority and relationship evidence. Existing rows remain auditable, but the model is not required to establish a Source Document or Retrieval Eligibility.
_Avoid_: translated copy, URL prefix, equivalent law

**Text Revision**:
An immutable editorial state of an Official Expression identified by the full official revision token and its evidence capture. Its editorial-validity interval is distinct from legal applicability.
_Avoid_: effective version, ingestion run, current document

**Provision Concept**:
A stable logical provision identity used to relate corresponding provisions across Text Revisions and Official Expressions, including renumbering, movement, split, merge, amendment, and repeal.
_Avoid_: article number, chunk ID, version-bound provision row

**Provision Rendition**:
The exact text and structural position of a Provision Concept in one Text Revision, preserved as immutable evidence.
_Avoid_: search result, embedding text, mutable provision body

**Applicability Period**:
A sourced half-open interval during which a Legal Instrument or Provision Concept has legal effect, carrying precision, certainty, and provenance independently of editorial revision dates.
_Avoid_: scrape date, Lex.uz ONDATE token, current-version flag

**Corpus Snapshot**:
A named immutable selection of Source Documents, Source Snapshots, Snapshot Provisions and Retrieval Eligibility findings accepted together at one cutoff. Legacy identity and authority rows may be referenced as audit provenance without becoming gates.
_Avoid_: database backup, index build, current corpus pointer

**Search Release**:
A named immutable set of retrieval candidates derived from one Corpus Snapshot for a single retrieval capability.
_Avoid_: live index, corpus source of truth, deployment

**Membership Lookup**:
An immutable, hash-verified physical projection of a Search Release's accepted membership inventory that locates candidate identities in small pages without changing their legal content, eligibility or ranking.
_Avoid_: answer cache, alternate corpus, new evidence

**Reference Lookup**:
A mapping from an explicitly cited provision within one Text Revision and language to candidate identities in the same Search Release. It discovers related provisions but does not establish their relevance or Requirement Support.
_Avoid_: answer template, citation validation, inferred law

**Activation Set**:
The named selection of mutually compatible Search Releases that defines which Indexed Official Corpus capabilities are available together.
_Avoid_: environment variable, mutable manifest, all-or-nothing migration

### Retrieval and coverage

**Retrieval Formulation**:
The request-local interpreted legal query sent unchanged to both the Sparse Candidate Lane and Dense Candidate Lane. It may include any user-entered content and is never part of the Indexed Official Corpus or persisted by JURO's retrieval runtime.
_Avoid_: privacy-transformed query, sanitized prompt, embedding prompt

**Live Official Search**:
Request-scoped retrieval from validated online Lex.uz pages when the Indexed Official Corpus does not provide sufficient current coverage.
_Avoid_: web search, internet search, Lex fallback

**Secondary Web Research**:
Cited research from the wider internet that supplies supporting context when useful. Answers using it visibly identify their internet provenance; it cannot establish a legal rule, deadline, calculation, or mandatory action.
_Avoid_: official source, legal authority, general search

**Source Ladder**:
The evidence-priority order from Indexed Official Corpus to Live Official Search, with Secondary Web Research providing attributed context when useful. Official evidence retains priority over secondary context.
_Avoid_: blended authority, interchangeable sources

**Official Coverage**:
The degree to which validated official evidence collectively supports every material legal proposition needed for a Legal Answer; coverage may be good, partial, weak, or absent.
_Avoid_: confidence score, best-source score, source count, retrieval success

**Plausible Reading**:
A materially distinct interpretation of a General Legal Question that could change which legal propositions or outcomes apply.
_Avoid_: assumption, query variant, Coverage Requirement

**Coverage Requirement**:
A distinct legal proposition required by a Plausible Reading that must be supported or explicitly left unresolved before JURO can claim good Official Coverage. Its identity, priority and scope (general rule, personal status, action stage, forum, claim kind or consequence) survive planning, retrieval repair and answer validation. Each requirement has an explicit answer-coverage entry referring to findings that still undergo claim and citation validation. Equivalent requirements may share a finding; distinct scopes cannot silently stand in for one another. An explicit core rule scope requires an ordinary governing finding, rather than a qualification alone.
_Avoid_: interpretation, facet, keyword, query concept

**Requirement Support**:
The validated relationship showing that one eligible official provision supports one Coverage Requirement. Candidate retrieval for a related formulation does not establish this relationship.
_Avoid_: query match, candidate membership, inherited requirement

**Provision Set**:
The complementary official provisions selected to satisfy the Coverage Requirements for one Legal Answer.
Its complete authenticated text must fit the shared evidence context budget. A count of short provisions alone does not justify dropping an operative rule; oversized sets remain explicitly unresolved. See [the evidence context decision](docs/adr/0011-bound-complete-verified-evidence-context.md).
_Avoid_: top results, hit list, citation count

**Source Unavailability**:
A temporary operational condition that prevents JURO from completing a Source Ladder check. It is distinct from absent Official Coverage and must not be presented as evidence that no applicable law exists.
_Avoid_: no coverage, no relevant law, insufficient evidence

### Workspace discovery

**Global Search**:
The tenant-scoped discovery surface for finding existing workspace items and available sources. It is distinct from the Source Ladder used to produce a Legal Answer.
_Avoid_: semantic search, Indexed Official Corpus, legal research

### Legal questions

**General Legal Question**:
A legal question that is not limited to an explicit, unambiguous act-and-provision lookup. It requires Question Interpretation and coverage-mapped retrieval before it can produce a Legal Answer, including when an exact citation is combined with general facts.
_Avoid_: vague query, semantic query, generic question

**Question Interpretation**:
The request-scoped understanding of a General Legal Question's language, Temporal Scope, material actors, actions, circumstances, outcomes, and materially plausible readings.
_Avoid_: model answer, legal conclusion, query rewrite

**Temporal Scope**:
Whether a Legal Answer concerns current law, law at a specified point in time, or a comparison between any two requested times. It determines which official versions are eligible evidence and prevents rules from different times from being silently mixed.
_Avoid_: freshness, date filter, current flag
