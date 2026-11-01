import assert from "node:assert/strict";
import test from "node:test";
import { publisherUrlForScope, verifyPublisherEdition } from "../lib/legal-answer-workflow/publisher-edition";

const timing = () => ({ submittedAt: Date.now() - 100, deadlineMs: 30_000 });
const observation = () => ({ requestedUrl: "https://lex.uz/docs/123", finalUrl: "https://lex.uz/docs/123",
  observedAt: new Date().toISOString(), selectedEditions: ["01.01.2020"], editionDates: ["01.01.2020", "01.01.2018"] });

test("current edition proof requires a fresh unqualified publisher endpoint and latest displayed edition", () => {
  const input = observation();
  const result = verifyPublisherEdition({ ...input, ...timing(), scope: { kind: "current" } });
  assert.equal(result.selectedEdition, "2020-01-01");
  assert.equal(result.kind, "current_publisher_edition");
  assert.throws(() => verifyPublisherEdition({ ...input, ...timing(), selectedEditions: ["01.01.2018"], scope: { kind: "current" } }), /EDITION_SELECTION/);
  assert.throws(() => verifyPublisherEdition({ ...input, ...timing(), finalUrl: input.finalUrl + "?ONDATE=01.01.2020", scope: { kind: "current" } }), /EDITION_ENDPOINT/);
  assert.throws(() => verifyPublisherEdition({ ...input, ...timing(), observedAt: "2020-01-01T00:00:00Z", scope: { kind: "current" } }), /EDITION_OBSERVATION/);
});

test("historical proof binds the requested day and rejects silently returned current editions", () => {
  const scope = { kind: "historical" as const, at: "2019-06-15" };
  const url = publisherUrlForScope("https://lex.uz/docs/123?ONDATE2=01.01.2020&action=compare#4", scope);
  assert.equal(url, "https://lex.uz/docs/123?ONDATE=15.06.2019");
  const input = { ...observation(), ...timing(), scope, requestedUrl: url, finalUrl: url, selectedEditions: ["01.01.2018"] };
  assert.equal(verifyPublisherEdition(input).requestedDate, scope.at);
  assert.throws(() => verifyPublisherEdition({ ...input, selectedEditions: ["01.01.2020"] }), /EDITION_SELECTION/);
  assert.throws(() => verifyPublisherEdition({ ...input, finalUrl: "https://lex.uz/docs/123" }), /EDITION_ENDPOINT/);
  assert.throws(() => verifyPublisherEdition({ ...input, selectedEditions: ["31.02.2018"] }), /EDITION_DATE/);
});

test("ambiguous selections, mismatched documents and unsupported comparison parameters are rejected", () => {
  const input = { ...observation(), ...timing(), scope: { kind: "current" as const } };
  assert.throws(() => verifyPublisherEdition({ ...input, selectedEditions: ["01.01.2018", "01.01.2020"] }), /EDITION_SELECTION/);
  assert.throws(() => verifyPublisherEdition({ ...input, finalUrl: "https://lex.uz/docs/999" }), /EDITION_ENDPOINT/);
  assert.throws(() => verifyPublisherEdition({ ...input, requestedUrl: input.requestedUrl + "?action=compare" }), /EDITION_ENDPOINT/);
});

test("opaque edition suffixes are preserved and an exact published edition can serve its later applicability day", () => {
  const url = "https://lex.uz/docs/123?ONDATE=01.01.2018+01";
  const result = verifyPublisherEdition({ ...observation(), ...timing(), requestedUrl: url, finalUrl: url,
    selectedEditions: ["01.01.2018 01"], editionDates: ["01.01.2020", "01.01.2018 01"],
    scope: { kind: "historical", at: "2019-06-15" } });
  assert.equal(result.selectedEditionToken, "01.01.2018 01");
  assert.equal(result.requestedDate, "2019-06-15");
});
