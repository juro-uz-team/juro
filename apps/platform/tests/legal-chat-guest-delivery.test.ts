import assert from "node:assert/strict";
import {structuredResponse} from "./helpers/structured-response";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";
import {parseIdentityKeyring} from "../lib/auth/keyring";
import {createGuestAiSession,guestAiClarificationRuns,revealGuestAiRunQuestion} from "../lib/ai/guest-session";
import {deliverGuestLegalChat,guestLegalChatRequestSchema} from "../lib/legal-chat/guest-delivery";
import {resolveAiRuntimeSettings} from "../lib/ai/runtime-settings";


