import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const caseLifecycle = source("app/_platform/case-lifecycle.css");
const reviewExports = source("app/_platform/document-review-exports.css");
const documentBuilder = source("app/_document-builder/document-builder.css");

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = hex
      .replace("#", "")
      .match(/.{2}/g)
      ?.map((value) => Number.parseInt(value, 16) / 255);
    assert.ok(channels);
    const [red, green, blue] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );
    return red * 0.2126 + green * 0.7152 + blue * 0.0722;
  };

  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test("case lifecycle controls and errors use shared theme surfaces", () => {
  assert.match(caseLifecycle, /background:\s*var\(--surface-raised\)/);
  assert.match(caseLifecycle, /color:\s*var\(--text-primary\)/);
  assert.match(caseLifecycle, /background:\s*var\(--red-bg\)/);
  assert.match(caseLifecycle, /html\[data-theme="dark"\] \.case-lifecycle-error/);
  assert.doesNotMatch(caseLifecycle, /background:\s*#(?:fff|fff2f0)\b/i);
});

test("review exports inherit semantic raised, subtle, and hover surfaces", () => {
  assert.match(reviewExports, /background:\s*var\(--surface-subtle\)/);
  assert.match(reviewExports, /background:\s*var\(--surface-raised\)/);
  assert.match(reviewExports, /background:\s*var\(--surface-hover\)/);
  assert.doesNotMatch(reviewExports, /background:\s*#(?:fff|f8f7f2|eef2f3)\b/i);
});

test("document builder separates dark-safe headings, controls, states, and paper", () => {
  assert.match(documentBuilder, /--dbt-cta:\s*var\(--interactive-primary\)/);
  assert.match(documentBuilder, /--dbt-on-cta:\s*var\(--text-on-action\)/);
  assert.doesNotMatch(documentBuilder, /--dbt-cta:\s*#/);
  assert.match(documentBuilder, /--dbt-ink:\s*var\(--text-primary/);
  assert.match(documentBuilder, /--dbt-ok-bg:\s*var\(--green-bg/);
  assert.match(documentBuilder, /--dbt-warn-bg:\s*var\(--amber-bg/);
  assert.match(documentBuilder, /--dbt-err-bg:\s*var\(--red-bg/);
  assert.match(documentBuilder, /\.dbt-form-card > header\s*\{[^}]*var\(--dbt-subtle\)[^}]*var\(--dbt-paper\)/s);
  assert.match(documentBuilder, /\.dbt-version-confirm-dialog\s*\{[^}]*background:\s*var\(--dbt-paper\)/s);
  assert.match(documentBuilder, /\.dbt-code-input\s*\{[^}]*background:\s*var\(--dbt-paper\)[^}]*color:\s*var\(--dbt-text\)/s);
  assert.match(documentBuilder, /\.dbt-public-document\s*\{[^}]*background:\s*var\(--dbt-subtle\)/s);
  assert.match(documentBuilder, /\.dbt-config-navigation\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--dbt-paper\) 96%, transparent\)/s);
  assert.equal(
    documentBuilder.match(/input:not\(\[type="checkbox"\], \[type="radio"\], \[type="hidden"\]\)/g)?.length,
    2,
  );
  assert.doesNotMatch(documentBuilder, /var\(--dbt-navy(?:-2)?\)/);
});

test("brand primary actions retain WCAG AA text contrast in both themes", () => {
  for (const [foreground, background] of [["#6c511f", "#f3ecdf"], ["#6c511f", "#eae0cd"], ["#f0ddb2", "#494638"], ["#f0ddb2", "#55503f"]]) {
    assert.ok(contrastRatio(foreground, background) >= 4.5);
  }
});

test("theme styles avoid broad transitions and preserve reduced-motion handling", () => {
  const styles = `${caseLifecycle}\n${reviewExports}\n${documentBuilder}`;
  assert.doesNotMatch(styles, /transition:\s*all\b/i);
  assert.match(caseLifecycle, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(reviewExports, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.match(documentBuilder, /@media \(prefers-reduced-motion:\s*reduce\)/);
});
