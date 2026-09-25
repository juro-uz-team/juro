import test from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtemp,writeFile,rm,mkdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname,resolve,basename} from "node:path";
import {readWorkingTreeProductRevision,verifyProductRevision} from "../lib/runtime/product-revision";
import {getSelfHostedRuntime} from "../lib/runtime/self-hosted";

test("only committed product bytes can identify a qualified source runtime",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"juro-product-revision-"));
  const previousOverride=process.env.JURO_COMPILED_PRODUCT_REVISION;
  const git=(...args:string[])=>execFileSync("git",args,{cwd:directory,encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
  try {
    assert.equal(readWorkingTreeProductRevision(directory),"unqualified");
    git("init");await writeFile(join(directory,".gitignore"),".next/\n");await writeFile(join(directory,"product.txt"),"original");git("add","product.txt",".gitignore");
    git("-c","user.name=Revision Test","-c","user.email=revision@example.test","-c","commit.gpgsign=false","commit","-m","Initial product");
    const first=git("rev-parse","HEAD");assert.equal(readWorkingTreeProductRevision(directory),first);
    assert.equal(verifyProductRevision(directory,first),"unqualified");
    await mkdir(join(directory,".next"));await writeFile(join(directory,".next","BUILD_ID"),first);
    assert.equal(verifyProductRevision(directory,first),first);
    process.env.JURO_COMPILED_PRODUCT_REVISION=first;
    await writeFile(join(directory,"product.txt"),"changed");assert.equal(readWorkingTreeProductRevision(directory),"unqualified");
    assert.equal(verifyProductRevision(directory,first),"unqualified");
    git("add","product.txt");git("-c","user.name=Revision Test","-c","user.email=revision@example.test","-c","commit.gpgsign=false","commit","-m","Changed product");
    const second=git("rev-parse","HEAD");assert.notEqual(second,first);assert.equal(readWorkingTreeProductRevision(directory),second);
    // A source handler arriving before the old compiled routes must also fail.
    assert.equal(verifyProductRevision(directory,first),"unqualified");
    await writeFile(join(directory,".next","BUILD_ID"),second);assert.equal(verifyProductRevision(directory,first),'unqualified');assert.equal(verifyProductRevision(directory,second),second);
    await writeFile(join(directory,"new-route.ts"),"export default 1;");assert.equal(readWorkingTreeProductRevision(directory),"unqualified");
  }finally{
    if(previousOverride===undefined)delete process.env.JURO_COMPILED_PRODUCT_REVISION;else process.env.JURO_COMPILED_PRODUCT_REVISION=previousOverride;
    assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.ok(basename(directory).startsWith("juro-product-revision-"));
    await rm(directory,{recursive:true,force:true});
  }
});

test("a caller from another build cannot reuse a source-initialized shared runtime",()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,"juroRuntimeProductRevision");
  try{
    Object.defineProperty(globalThis,"juroRuntimeProductRevision",{value:"0".repeat(40),writable:true,configurable:true});
    assert.throws(()=>getSelfHostedRuntime(),/NATIVE_RUNTIME_BUILD_MISMATCH/);
  }finally{
    if(previous)Object.defineProperty(globalThis,"juroRuntimeProductRevision",previous);
    else Reflect.deleteProperty(globalThis,"juroRuntimeProductRevision");
  }
});
