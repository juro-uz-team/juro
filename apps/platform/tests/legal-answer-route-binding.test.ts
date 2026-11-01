import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("application POST binds directly to the fresh entrypoint and fresh modules do not import old chat orchestration", () => {
  for (const [path, entry] of [["platform", "platformLegalAnswerPost"], ["guest", "guestLegalAnswerPost"]]) {
  const route = new URL(`../app/api/${path}/ai/route.ts`, import.meta.url);
  const source = ts.createSourceFile(route.pathname, readFileSync(route, "utf8"), ts.ScriptTarget.Latest, true);
  const post = source.statements.filter(ts.isVariableStatement)
    .flatMap(statement => [...statement.declarationList.declarations])
    .find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "POST");
  assert.ok(post?.initializer && ts.isIdentifier(post.initializer));
  assert.equal(post.initializer.text, entry);
  const imports = source.statements.filter(ts.isImportDeclaration);
  assert.ok(imports.some(node => ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === "../../../../lib/legal-answer-workflow/platform-entry"));
  if (path === "guest") {
    const get = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
      .find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "GET");
    assert.ok(get?.initializer && ts.isIdentifier(get.initializer));
    assert.equal(get.initializer.text, "guestLegalAnswerGet");
    assert.ok(imports.every(node => ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === "../../../../lib/legal-answer-workflow/platform-entry"));
  }
  if (path === "platform") for (const method of ["GET", "DELETE"]) {
    const declaration = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
      .find(item => ts.isIdentifier(item.name) && item.name.text === method);
    assert.ok(declaration?.initializer && ts.isIdentifier(declaration.initializer));
    assert.equal(declaration.initializer.text, "platformLegalAnswerBrowser");
    assert.ok(imports.every(node => ts.isStringLiteral(node.moduleSpecifier)
      && node.moduleSpecifier.text === "../../../../lib/legal-answer-workflow/platform-entry"));
  }
  }
  const citationRoute = new URL("../app/api/platform/ai/citations/[messageId]/route.ts", import.meta.url);
  const citationModule = ts.createSourceFile(citationRoute.pathname, readFileSync(citationRoute, "utf8"), ts.ScriptTarget.Latest, true);
  const citationGet = citationModule.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
    .find(item => ts.isIdentifier(item.name) && item.name.text === "GET");
  assert.ok(citationGet?.initializer && ts.isIdentifier(citationGet.initializer));
  assert.equal(citationGet.initializer.text, "platformSavedCitationGet");
  assert.ok(citationModule.statements.filter(ts.isImportDeclaration).every(node => ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text === "../../../../../../lib/legal-answer-workflow/platform-entry"));
  const directory = new URL("../lib/legal-answer-workflow/", import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith(".ts"))) {
    const parsedModule = ts.createSourceFile(file, readFileSync(new URL(file, directory), "utf8"), ts.ScriptTarget.Latest, true);
    for (const node of parsedModule.statements.filter(ts.isImportDeclaration)) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier));
      assert.doesNotMatch(node.moduleSpecifier.text, /(?:^|\/)legal-chat\//u, `${file} imports old chat code`);
    }
  }
});
