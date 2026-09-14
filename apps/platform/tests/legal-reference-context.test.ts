import assert from "node:assert/strict";
import test from "node:test";
import { selectionAssessmentBatches, selectionReferenceContext } from "../lib/legal-corpus/selection-reference-context";

function selectionCandidate(itemKey: string, retrievalRequirementIds: string[], score: number) {
  return {
    candidate: {
      candidate: {
        itemKey,
        instanceId: "instance-one",
        shardId: "shard-one",
        formulationIds: ["formulation-one"],
        formulationMatches: [{
          formulationId: "formulation-one",
          rank: 1,
          fusionScore: score,
        }],
        readingIds: ["reading-one", "reading-two"],
        retrievalRequirementIds,
        vectorRank: 1,
        vectorScore: score,
        keywordRank: 1,
        keywordScore: score,
        fusionScore: score,
      },
      canonicalChunkId: `chunk-${itemKey}`,
      provisionRenditionId: `rendition-${itemKey}`,
      textRevisionId: `revision-${itemKey}`,
      provisionConceptId: `concept-${itemKey}`,
      languageFamily: "en" as const,
      textualAuthority: "controlling" as const,
    },
    citationLabel: `Act — Article ${itemKey}`,
    provisionText: `Verified provision text for ${itemKey}`,
  };
}

test("assessment batches see already verified references without mixing revisions", () => {
  const source = selectionCandidate("source", ["requirement-one"], 0.9);
  source.provisionText = "The exception is defined in Article 732 of this Act.";
  const reference = selectionCandidate("reference", ["requirement-one"], 0.8);
  reference.citationLabel = "Example Act — Article 732";
  reference.candidate.textRevisionId = source.candidate.textRevisionId;
  reference.provisionText = "Article 732. The exception requires written notice.";
  const otherRevision = selectionCandidate("other", ["requirement-one"], 0.7);
  otherRevision.citationLabel = reference.citationLabel;
  assert.deepEqual(selectionReferenceContext([source], [source, otherRevision, reference]).map(({citationLabel, provisionText}) => ({citationLabel, provisionText})),
    [{citationLabel: reference.citationLabel, provisionText: reference.provisionText}]);
  assert.deepEqual(selectionReferenceContext([source, reference], [source, reference]), []);
  source.provisionText = "See Article 732 of a different Act.";
  assert.deepEqual(selectionReferenceContext([source], [source, reference]), []);
  source.provisionText = "No explicit reference is supplied.";
  assert.deepEqual(selectionReferenceContext([source], [source, reference]), []);
});

test("assessment groups an explicit rule and its grounds without dropping intervening candidates", () => {
  const source = selectionCandidate("referring-rule", ["requirement-one"], 0.9);
  source.citationLabel = "Example Act — Article 700";
  source.provisionText = "Only the grounds in Article 732 of this Act apply.";
  const noise = Array.from({length: 9}, (_, index) => selectionCandidate(`other-${index}`, ["requirement-one"], 0.8));
  const grounds = selectionCandidate("referenced-grounds", ["requirement-one"], 0.7);
  grounds.candidate.textRevisionId = source.candidate.textRevisionId;
  grounds.citationLabel = "Example Act — Article 732";
  const input = [source, ...noise, grounds];
  const batches = selectionAssessmentBatches(input, 8);
  assert.equal(batches[0]?.includes(grounds), true, "explicitly referenced grounds must be in the referring rule's batch");
  assert.ok(batches.every(batch => batch.length <= 8));
  assert.equal(batches.flat().length, input.length);
  assert.deepEqual(new Set(batches.flat()), new Set(input));
  const foreign = structuredClone(grounds);
  foreign.candidate.textRevisionId = "foreign-revision";
  assert.ok(!selectionAssessmentBatches([source, ...noise, foreign], 8)[0]?.includes(foreign));
  assert.throws(() => selectionAssessmentBatches(input, 0));
});

test("referenced grounds see the referring status rule during their own assessment", () => {
  const referring = selectionCandidate("protected-status", ["requirement-one"], 0.9);
  referring.citationLabel = "Example Act — Article 700";
  referring.provisionText = "For a licensed representative, only the grounds in Article 732 of this Act apply.";
  const grounds = selectionCandidate("grounds", ["requirement-one"], 0.8);
  grounds.citationLabel = "Example Act — Article 732";
  grounds.provisionText = "Article 732. The grounds are dissolution and serious misconduct.";
  grounds.candidate.textRevisionId = referring.candidate.textRevisionId;
  assert.deepEqual(selectionReferenceContext([grounds], [grounds, referring]).map(({citationLabel, provisionText}) => ({citationLabel, provisionText})),
    [{citationLabel: referring.citationLabel, provisionText: referring.provisionText}]);
  const foreign = structuredClone(referring);
  foreign.candidate.textRevisionId = "another-revision";
  assert.deepEqual(selectionReferenceContext([grounds], [grounds, foreign]), []);
  referring.provisionText = "See Article 732 of another Act.";
  assert.deepEqual(selectionReferenceContext([grounds], [grounds, referring]), []);
});

test("complete reference chains cross assessment batches without the former four-context ceiling", () => {
  const chain = Array.from({length: 12}, (_, index) => {
    const candidate = selectionCandidate(`chain-${index}`, ["requirement-one"], 0.8);
    candidate.candidate.textRevisionId = "same-authenticated-revision";
    candidate.citationLabel = `Example Act — Article ${700 + index}`;
    candidate.provisionText = index === 11 ? "Written notice is required."
      : `The conditions in Article ${701 + index} of this Act also apply.`;
    return candidate;
  });
  const batches = selectionAssessmentBatches(chain, 8);
  assert.equal(batches.length, 2);
  const context = selectionReferenceContext(batches[1]!, chain);
  assert.equal(context.length, 8);
  assert.deepEqual(new Set(context.map(item => item.evidenceIdentity.provisionRenditionId)),
    new Set(chain.slice(0, 8).map(item => item.candidate.provisionRenditionId)));
  assert.ok(context.every(item => item.evidenceIdentity.textRevisionId === "same-authenticated-revision"));
  const otherLanguage = {...chain[0]!, candidate: {...chain[0]!.candidate,
    languageFamily: "ru", candidate: {...chain[0]!.candidate.candidate, itemKey: "other-language"}}};
  assert.equal(selectionReferenceContext([chain[1]!], [chain[1]!, otherLanguage]).length, 0);
});

test("assessment partitions complete short provisions and rejects oversized connected material explicitly", () => {
  const short = Array.from({length: 13}, (_, index) => selectionCandidate(`short-${index}`, ["requirement-one"], 0.8));
  assert.equal(selectionAssessmentBatches(short, 8).flat().length, 13);
  const long = short.map(item => ({...item, provisionText: "Complete paragraph. ".repeat(600)}));
  const batches = selectionAssessmentBatches(long, 8);
  assert.equal(batches.flat().length, 13);
  assert.ok(batches.every(batch => batch.reduce((total, item) => total + item.provisionText.length, 0) <= 32_000));
  const source = selectionCandidate("oversized-source", ["requirement-one"], 0.8);
  source.provisionText = "Complete verified material. ".repeat(2000);
  assert.throws(() => selectionAssessmentBatches([source], 8), /INDEXED_EVIDENCE_CONTEXT_EXCEEDED/u);
  const pair = long.slice(0, 2).map((item, index) => ({...item,
    candidate: {...item.candidate, textRevisionId: "shared-revision"},
    citationLabel: `Example Act — Article ${700 + index}`,
    provisionText: `See Article ${index === 0 ? 701 : 700} of this Act. ${"Operative condition. ".repeat(900)}`,
  }));
  assert.throws(() => selectionAssessmentBatches(pair, 8), /INDEXED_EVIDENCE_CONTEXT_EXCEEDED/u);
});
