import test from "node:test";
import assert from "node:assert/strict";
import { createChallenge } from "altcha-lib/v1";
import { verifyNativeChallenge } from "../lib/auth/native-challenge";
const secret = "a".repeat(64);
async function token(action = "auth_registration", hostname = "app.juro.uz", expires = new Date(Date.now()+60_000)) {
  const challenge = await createChallenge({ hmacKey:secret,algorithm:"SHA-256",number:42,expires,params:{action,hostname} });
  return Buffer.from(JSON.stringify({...challenge,number:42})).toString("base64");
}
test("native challenges require authentic work, matching action/host and unexpired lifetime", async () => {
  let consumed=0;
  const input={secret,hostname:"app.juro.uz",actions:["auth_registration"],consume:async()=>{consumed++;return true;}};
  assert.equal(await verifyNativeChallenge({...input,token:await token()}),true);
  for(const invalid of ["private-local",await token("auth_password_login"),await token("auth_registration","evil.example"),await token("auth_registration","app.juro.uz",new Date(Date.now()-1000))]) assert.equal(await verifyNativeChallenge({...input,token:invalid}),false);
  const forged=JSON.parse(Buffer.from(await token(),"base64").toString());forged.number=43;
  assert.equal(await verifyNativeChallenge({...input,token:Buffer.from(JSON.stringify(forged)).toString("base64")}),false);
  assert.equal(consumed,1);
});
test("a valid solution is accepted only once, and a failed redemption fails closed", async () => {
  const seen=new Set<string>();const value=await token();
  const input={secret,hostname:"app.juro.uz",actions:["auth_registration"],token:value,consume:async(id:string)=>{if(seen.has(id))return false;seen.add(id);return true;}};
  assert.equal(await verifyNativeChallenge(input),true);
  assert.equal(await verifyNativeChallenge(input),false);
  assert.equal(await verifyNativeChallenge({...input,consume:async()=>{throw new Error("database unavailable");}}),false);
});
