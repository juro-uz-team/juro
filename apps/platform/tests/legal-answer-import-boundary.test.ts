import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

test("fresh runtime imports cannot reach retired chat modules through shared services", () => {
  const platform = fileURLToPath(new URL("../", import.meta.url));
  const visited = new Set<string>();
  const violations: string[][] = [];
  const unresolved: string[] = [];
  function visit(file: string, chain: string[]) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    function inspect(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (clause?.isTypeOnly) return;
        if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.every(element => element.isTypeOnly)) return;
        if (ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      } else if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) {
        if (node.exportClause && ts.isNamedExports(node.exportClause) && node.exportClause.elements.every(element => element.isTypeOnly)) return;
        if (ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        if (node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
        else unresolved.push(`${path.relative(platform, file)}: computed module import`);
      }
      ts.forEachChild(node, inspect);
    }
    inspect(source);
    for (const specifier of imports) {
      if (!specifier.startsWith(".")) {
        if (specifier.startsWith("@/")) unresolved.push(`${file}: ${specifier}`);
        continue;
      }
      const base = path.resolve(path.dirname(file), specifier);
      if (base.endsWith(".json") && existsSync(base)) { JSON.parse(readFileSync(base, "utf8")); continue; }
      const next = [base, ...[".ts", ".tsx", ".mjs", ".js"].map(extension => base + extension),
        path.join(base, "index.ts"), path.join(base, "index.js")].find(candidate =>
        /\.(?:ts|tsx|mjs|js)$/.test(candidate) && existsSync(candidate));
      if (!next) { unresolved.push(`${file}: ${specifier}`); continue; }
      const relative = path.relative(platform, next).replaceAll("\\", "/");
      if (relative.startsWith("lib/legal-chat/")) { violations.push([...chain, relative]); continue; }
      visit(next, [...chain, relative]);
    }
  }
  visit(path.join(platform, "lib/legal-answer-workflow/platform-entry.ts"), ["platform-entry"]);
  visit(path.join(platform, "app/api/platform/ai/route.ts"), ["signed-route"]);
  visit(path.join(platform, "app/api/guest/ai/route.ts"), ["guest-route"]);
  visit(path.join(platform, "app/api/platform/ai/citations/[messageId]/route.ts"), ["citation-route"]);
  for (const route of ["action-plan", "suggested-document", "memory", "facts", "feedback", "intake", "intake/finalize", "intake/consume"]) {
    visit(path.join(platform, `app/api/platform/ai/${route}/route.ts`), [route]);
  }
  assert.deepEqual(violations, [], "Retired chat import paths");
  assert.deepEqual(unresolved, [], "Unverified runtime module imports");
  assert.ok(visited.size > 100, "Must traverse shared runtime dependencies");
});
