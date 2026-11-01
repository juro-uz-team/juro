import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {createQuestionInterpreter} from "../lib/legal-chat/question-model";
import {createLegalResearchModel} from "../lib/legal-chat/research-model";
import {privateDocumentContext} from "./helpers/private-document-context";

// Indexed-document release, tenant and checksum boundaries are exercised by
// user-document-vectors.test.ts; these checks inspect the actual provider wire.

