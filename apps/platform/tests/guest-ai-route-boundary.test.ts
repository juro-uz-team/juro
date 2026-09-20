import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/[locale]/guest/ai-lawyer/page.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../app/_guest/GuestAiClient.tsx", import.meta.url), "utf8");

test("guest AI page is noindex, RU/UZ/EN localized, and exposes no fake success path", () => {
  assert.match(page, /robots:\s*\{\s*index:\s*false,\s*follow:\s*false/);
  assert.match(page, /guestAiEnabled\(runtimeEnv\(\)\)/);
  assert.match(client, /\/api\/guest\/ai/);
  assert.match(client, /action="guest_ai"/);
  assert.match(client, /Гостевые данные удаляются через 24 часа/);
  assert.match(client, /Mehmon ma’lumotlari 24 soatdan keyin o‘chiriladi/);
  assert.match(client, /Guest data is deleted after 24 hours/);
  assert.match(client, /"x-juro-locale":\s*locale/);
  assert.doesNotMatch(client, /setTimeout\([^)]*(?:success|result)/i);
});
