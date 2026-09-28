import assert from "node:assert/strict";
import {pbkdf2Sync,randomBytes} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {hashPassword,verifyPassword,upgradeVerifiedLegacyPassword,type PasswordCredential} from "../lib/auth/password";

function legacy(password:string):PasswordCredential {
  const salt=randomBytes(16);
  return {userId:"legacy-user",algorithm:"PBKDF2-SHA256",iterations:100000,saltBase64url:salt.toString("base64url"),
    hashBase64url:pbkdf2Sync(password,salt,100000,32,"sha256").toString("base64url"),passwordChangedAt:"2026-01-01T00:00:00.000Z"};
}
test("known production password hashes verify without accepting other weak work factors",async()=>{
  const credential=legacy("A preserved production passphrase");
  assert.equal(await verifyPassword("A preserved production passphrase",credential),true);
  assert.equal(await verifyPassword("An incorrect passphrase",credential),false);
  for(const iterations of [0,99999,100001,309999,1000001])assert.equal(await verifyPassword("A preserved production passphrase",{...credential,iterations}),false);
});
test("legacy upgrade preserves password age and cannot overwrite a concurrent password reset",async()=>{
  const sqlite=new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE user_password_credentials (user_id text PRIMARY KEY,algorithm text,iterations integer,salt_base64url text,hash_base64url text,password_changed_at text,updated_at text)");
  const db={prepare(sql:string){return {bind(...values:unknown[]){return {async run(){return {meta:{changes:sqlite.prepare(sql).run(...values as (string|number)[]).changes}};}};}};}} as unknown as D1Database;
  const password="A preserved production passphrase",credential=legacy(password);
  const insert=()=>sqlite.prepare("INSERT INTO user_password_credentials VALUES(?,?,?,?,?,?,?)").run(credential.userId,credential.algorithm,credential.iterations,credential.saltBase64url,credential.hashBase64url,credential.passwordChangedAt,credential.passwordChangedAt);
  try {
    insert();
    assert.equal(await upgradeVerifiedLegacyPassword(db,password,credential),true);
    const upgraded=sqlite.prepare("SELECT iterations,salt_base64url AS saltBase64url,hash_base64url AS hashBase64url,password_changed_at AS passwordChangedAt FROM user_password_credentials").get()!;
    assert.equal(upgraded.iterations,600000);assert.equal(upgraded.passwordChangedAt,credential.passwordChangedAt);
    assert.equal(await verifyPassword(password,{...credential,...upgraded}),true);
    sqlite.exec("DELETE FROM user_password_credentials");insert();
    const reset=await hashPassword("A concurrent replacement passphrase");
    sqlite.prepare("UPDATE user_password_credentials SET iterations=?,salt_base64url=?,hash_base64url=?,password_changed_at=?").run(reset.iterations,reset.saltBase64url,reset.hashBase64url,"2026-02-01T00:00:00.000Z");
    assert.equal(await upgradeVerifiedLegacyPassword(db,password,credential),false);
    assert.equal(sqlite.prepare("SELECT hash_base64url AS hash FROM user_password_credentials").get()!.hash,reset.hashBase64url);
  } finally {sqlite.close();}
});
