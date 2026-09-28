import assert from "node:assert/strict";
import test from "node:test";
import {routeNativeDomain} from "../lib/runtime/domain-routing";

const config={lawyerOrigin:"https://lawyer.juro.uz",statusOrigin:"https://status.juro.uz"};
test("lawyer entry preserves locale, account type and dedicated workspace views",()=>{
  for(const [source,target] of [["/","/ru/auth/login?accountType=lawyer"],["/en/register","/en/auth/register?accountType=lawyer"],["/uz/messages?case=example","/uz/lawyer/consultations?case=example&view=messages"],["/en/individual/dashboard","/en/lawyer/dashboard"],["/api/auth/password-login","/api/auth/password-login"]]) {
    const result=routeNativeDomain(new URL(source!,config.lawyerOrigin),"GET",config);
    assert.equal(result.status,0);assert.equal(result.lawyerHost,true);
    assert.equal(result.url.pathname+result.url.search,target);
    assert.equal(result.url.origin,config.lawyerOrigin);
  }
  assert.equal(routeNativeDomain(new URL("/en/individual/settings",config.lawyerOrigin),"GET",config).status,404);
});
test("status host permits only read-only status pages and static assets",()=>{
  for(const path of ["/","/en","/uz/status","/api/status","/_next/static/chunks/app.js","/favicon.png"]) {
    assert.equal(routeNativeDomain(new URL(path,config.statusOrigin),"GET",config).status,0);
    assert.equal(routeNativeDomain(new URL(path,config.statusOrigin),"POST",config).status,405);
  }
  for(const path of ["/api/auth/challenge","/api/internal/admin/health","/api/platform/admin/jobs","/en/auth/login","/_next/image","/_next/static/%2f..%2fapi/auth/login"]) {
    assert.equal(routeNativeDomain(new URL(path,config.statusOrigin),"GET",config).status,404);
  }
  assert.equal(routeNativeDomain(new URL("/",config.statusOrigin),"GET",config).url.pathname,"/status");
  assert.equal(routeNativeDomain(new URL("/en",config.statusOrigin),"HEAD",config).url.pathname,"/en/status");
});
test("ordinary application domains do not acquire lawyer or status identity",()=>{
  const url=new URL("https://app.juro.uz/en/individual/dashboard");
  const result=routeNativeDomain(url,"GET",config);
  assert.equal(result.url,url);assert.equal(result.status,0);
  assert.equal(result.lawyerHost,false);assert.equal(result.statusHost,false);
});
