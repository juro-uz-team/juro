import { z } from "zod";
import { articleNumberFromHeading } from "./normalized-document";

const unitSchema = z.object({ ordinal: z.number().int().nonnegative(), locator: z.string(), text: z.string(),
  language: z.enum(["en", "ru", "uz-Latn", "uz-Cyrl"]), hierarchy: z.array(z.string()) });
const tableSchema = z.object({ locator: z.string().nullable(), rows: z.array(z.array(z.object({
  text: z.string(), colspan: z.union([z.string(), z.number()]).optional(), rowspan: z.union([z.string(), z.number()]).optional(),
}))) });
const preparedSchema = z.object({ work: z.string(), title: z.string(), units: z.array(unitSchema).min(1),
  gaps: z.array(z.unknown()), tables: z.array(tableSchema), header: z.array(z.string()).optional(),
  notices: z.array(z.unknown()).optional() });
const ancestor = (parent: string[], child: string[]) => parent.length <= child.length && parent.every((part, index) => part === child[index]);

function sectionRange(units: z.infer<typeof unitSchema>[], start: number) {
  const selected = units[start], hierarchy = selected.hierarchy;
  if (!hierarchy.length || selected.text.trim() !== hierarchy.at(-1)!.trim()
    || /^[«“"]/u.test(selected.text.trim()) || articleNumberFromHeading(selected.text) !== undefined
    || hierarchy.some(heading => /^[«“"]/u.test(heading.trim()) || articleNumberFromHeading(heading) !== undefined)
    || units.slice(0, start).some(unit => ancestor(hierarchy, unit.hierarchy))) return null;
  let end = start + 1;
  while (end < units.length && ancestor(hierarchy, units[end].hierarchy)) end++;
  if (units.slice(end).some(unit => ancestor(hierarchy, unit.hierarchy))) return null;
  const next = units[end];
  if (next && next.text.trim() !== next.hierarchy.at(-1)?.trim()
    && articleNumberFromHeading(next.text) === undefined) return null;
  return { start, end, title: selected.text };
}

function enclosingQuotationEnds(units: z.infer<typeof unitSchema>[]) {
  const stack: { close: string; unit: number }[] = [];
  const closingAtOpening = new Int32Array(units.length).fill(-1);
  for (let index = 0; index < units.length; index++) {
    for (const match of units[index].text.matchAll(/[«»“”"]/gu)) {
      const quote = match[0];
      if (quote === "«" || quote === "“" || (quote === '"' && stack.at(-1)?.close !== '"')) {
        stack.push({ close: quote === "«" ? "»" : quote === "“" ? "”" : '"', unit: index });
      } else {
        const opening = stack.pop();
        if (opening?.close === quote) closingAtOpening[opening.unit] = Math.max(closingAtOpening[opening.unit], index);
      }
    }
  }
  const endsBefore = new Int32Array(units.length);
  let latestEnd = -1;
  for (let index = 0; index < units.length; index++) {
    endsBefore[index] = latestEnd;
    latestEnd = Math.max(latestEnd, closingAtOpening[index]);
  }
  return endsBefore;
}

function structuralHeadings(units: z.infer<typeof unitSchema>[]) {
  const stack: string[] = [];
  let malformed = false;
  const boundaries = units.map(unit => {
    const outside = stack.length === 0 && !malformed;
    for (const match of unit.text.matchAll(/[«»“”"]/gu)) {
      const quote = match[0];
      if (quote === "«" || quote === "“") stack.push(quote === "«" ? "»" : "”");
      else if (quote === '"' && stack.at(-1) !== '"') stack.push('"');
      else if (stack.pop() !== quote) malformed = true;
    }
    return { outside, heading: outside && Boolean(articleNumberFromHeading(unit.text)),
      closed: stack.length === 0 && !malformed };
  });
  return boundaries;
}

/** Read a complete structural range of already prepared units. Never parse or rewrite publisher source. */
type ProvisionTarget = { work: string; position: string; language: string;
  wholeDocument?: boolean; wholeSection?: boolean };

export function readPreparedProvision(value: unknown, target: ProvisionTarget) {
  return createPreparedProvisionReader(value)(target);
}

/** Index one retained source once; each read still returns its complete structural extent. */
export function createPreparedProvisionReader(value: unknown) {
  const source = preparedSchema.parse(value);
  if (source.gaps.length) throw new Error("PREPARED_EXTRACTION_GAP");
  let previous = -1;
  for (const unit of source.units) {
    if (unit.ordinal <= previous) throw new Error("PREPARED_UNIT_ORDER");
    previous = unit.ordinal;
  }
  const structure = structuralHeadings(source.units);
  // These literal publisher labels supply navigation context only. Retained
  // hierarchy paths can continue across annexes; never rewrite v1 read extents.
  const annexMarker = /^(?:ПРИЛОЖЕНИЕ\s*(?:№|N\b|\d)|(?:ANNEX|APPENDIX)\s+(?:\d+|[A-Z]|[IVXLCDM]+)(?:\s|[.:]|$)|\d+[\s-]*(?:ILOVA|ИЛОВА)(?:\s|[.:]|$)|(?:ILOVA|ИЛОВА)\s*№)/iu;
  const annexStarts = source.units.flatMap((unit, index) => structure[index].outside
    && annexMarker.test(unit.text.trim()) ? [index] : []);
  const annexes = annexStarts.map((start, offset) => {
    const limit = annexStarts[offset + 1] ?? source.units.length;
    let end = start + 1;
    // Keep the exact preface before the first explicit local heading. If no
    // heading establishes its extent, expose only the unambiguous marker.
    for (let index = start + 1; index < limit; index++) {
      const unit = source.units[index];
      if (structure[index].outside && (structure[index].heading
        || unit.text.trim() === unit.hierarchy.at(-1)?.trim())) { end = index; break; }
    }
    return { start, units: source.units.slice(start, end).map(unit => ({ position: unit.locator,
      ordinal: unit.ordinal, language: unit.language, text: unit.text })) };
  });
  const annexContext = (start: number, end: number) => {
    const preceding = annexes.findLast(annex => annex.start < start);
    return annexes.filter(annex => annex === preceding || (annex.start >= start && annex.start < end))
      .map(annex => ({ relation: annex.start < start ? "preceding" as const : "within" as const,
        units: annex.units.map(unit => ({ ...unit })) }));
  };
  // A section is enclosed exactly when a quote opened before its start and
  // closes at or after its end. Index those spans once for all navigation reads.
  let quotationEnds: Int32Array | undefined;
  const positions = new Map<string, number[]>();
  for (const [index, unit] of source.units.entries()) {
    const matches = positions.get(unit.locator) ?? [];
    matches.push(index); positions.set(unit.locator, matches);
  }
  const normalizeSpace = (text: string) => text.replace(/\s+/gu, " ").trim();
  const tableTexts = source.tables.map(table => normalizeSpace(table.rows.flatMap(row => row.map(cell => cell.text)).join(" ")));
  const tables = source.tables.map((table, index) => {
    if (table.locator !== null) return table;
    const text = tableTexts[index];
    const matches = text ? source.units.filter(unit => normalizeSpace(unit.text) === text) : [];
    // Some retained tables lack an anchor although their entire cell text is also
    // stored as one located unit. Only a unique complete match establishes position.
    if (matches.length !== 1 || tableTexts.filter(value => value === text).length !== 1) {
      throw new Error("PREPARED_TABLE_POSITION_UNAVAILABLE");
    }
    return { ...table, locator: matches[0].locator };
  });
  if (tables.some(table => !table.locator || positions.get(table.locator)?.length !== 1)) throw new Error("PREPARED_TABLE_POSITION_UNAVAILABLE");
  const range = (target: ProvisionTarget) => {
    if (source.work !== target.work) throw new Error("CORPUS_SOURCE_IDENTITY");
    const matches = positions.get(target.position) ?? [];
    if (matches.length !== 1) throw new Error("PREPARED_POSITION_UNAVAILABLE");
    const selectedIndex = matches[0];
    if (source.units[selectedIndex].language !== target.language) throw new Error("CORPUS_SOURCE_IDENTITY");
    let start = -1;
    for (let index = selectedIndex; index >= 0; index--) {
      const unit = source.units[index];
      if (structure[index].heading && ancestor(unit.hierarchy, source.units[selectedIndex].hierarchy)) {
        start = index;
        break;
      }
      if (!ancestor(unit.hierarchy, source.units[selectedIndex].hierarchy)) break;
    }
    let end = source.units.length;
    let articleTitle: string | null = null;
    if (start >= 0) {
      articleTitle = source.units[start].text;
      for (let index = start + 1; index < source.units.length; index++) {
        const unit = source.units[index];
        if (structure[index].heading || !ancestor(source.units[start].hierarchy, unit.hierarchy)) {
          end = index;
          break;
        }
      }
    }
    // An uncertain article boundary cannot exclude context. The complete stored
    // document has an explicit extent even when its quotation punctuation is unbalanced.
    if (target.wholeDocument || start < 0 || selectedIndex >= end || !structure[end - 1].closed) {
      start = 0;
      end = source.units.length;
      articleTitle = null;
    }
    let sectionTitle: string | null = null;
    // Exact retained hierarchy boundaries establish a complete section without
    // guessing which of its articles are relevant or repairing publisher text.
    // Hierarchy establishes the extent independently of punctuation elsewhere in
    // the act. Scoped punctuation is an additional check, not proof that no quote
    // began earlier; quoted ancestry and demonstrably enclosing quotes are also rejected.
    const safeSection = (index: number) => {
      const range = sectionRange(source.units, index);
      return range && range.start <= selectedIndex && selectedIndex < range.end
        && structuralHeadings(source.units.slice(range.start, range.end)).at(-1)!.closed
        && (quotationEnds ??= enclosingQuotationEnds(source.units))[range.start] < range.end ? range : null;
    };
    let section = !target.wholeDocument && target.wholeSection !== false ? safeSection(selectedIndex) : null;
    if (!section && articleTitle === null && !target.wholeDocument && target.wholeSection === undefined) {
      const hierarchy = source.units[selectedIndex].hierarchy;
      // At most one candidate per retained hierarchy level; never infer a window
      // from apparent relevance or silently change the extent of an existing key.
      const examined = new Set<number>();
      if (hierarchy.length <= 16) for (let index = selectedIndex - 1; index >= 0; index--) {
        const unit = source.units[index], depth = unit.hierarchy.length;
        if (!depth || examined.has(depth) || !ancestor(unit.hierarchy, hierarchy)
          || unit.text.trim() !== unit.hierarchy.at(-1)!.trim()) continue;
        examined.add(depth);
        section = safeSection(index);
        if (section) break;
      }
    }
    if (target.wholeSection && !section) throw new Error("PREPARED_SECTION_UNAVAILABLE");
    if (section) {
      start = section.start; end = section.end; sectionTitle = section.title; articleTitle = null;
    }
    return { start, end, articleTitle, sectionTitle, units: source.units.slice(start, end) };
  };
  const partsFor = (units: z.infer<typeof unitSchema>[]) => {
    // The selected unit binds the request language. Complete retained ranges can
    // contain quotations, bilingual forms or publisher notes in other languages.
    // Publisher status and amendment context must not disappear when an article is read.
    const parts = [source.title, ...(source.header ?? []),
      ...(source.notices ?? []).map(notice => typeof notice === "string" ? notice : JSON.stringify(notice))];
    for (const unit of units) {
      parts.push(unit.text);
      for (const table of tables.filter(table => table.locator === unit.locator)) {
        parts.push(table.rows.map(row => row.map(cell => {
          const rowSpan = Number(cell.rowspan ?? 1), colSpan = Number(cell.colspan ?? 1);
          if (!Number.isSafeInteger(rowSpan) || rowSpan < 1 || !Number.isSafeInteger(colSpan) || colSpan < 1) {
            throw new Error("PREPARED_TABLE_SPAN_INVALID");
          }
          return cell.text + (rowSpan === 1 && colSpan === 1 ? "" : ` [row span ${rowSpan}; column span ${colSpan}]`);
        }).join(" | ")).join("\n"));
      }
    }
    if (!parts.some(part => part.trim())) throw new Error("PROVISION_CONTEXT_BOUND");
    return parts;
  };
  const describe = (target: ProvisionTarget) => {
    const { start, end, units, articleTitle, sectionTitle } = range(target);
    // Validate the same selected text/tables, without joining overlapping section
    // text or constructing citation headings for a navigation-only directory.
    const parts = partsFor(units);
    const textByteCount = parts.reduce((sum, part) => sum + Buffer.byteLength(part, "utf8"), 0) + Math.max(0, parts.length - 1) * 2;
    // Old range rendering remains immutable for saved citations. New article
    // selection must reject ranges spanning structural section headings instead
    // of silently treating an earlier article as their governing boundary.
    const containsSectionHeadings = units.some(unit => unit.hierarchy.length
      && unit.text.trim() === unit.hierarchy.at(-1)!.trim()
      && articleNumberFromHeading(unit.text) === undefined);
    const context = annexContext(start, end);
    return { title: source.title, articleTitle, sectionTitle, position: units[0].locator, textByteCount, unitCount: units.length,
      ...(containsSectionHeadings ? { containsSectionHeadings: true } : {}),
      ...(context.length ? { annexContext: context } : {}),
      language: units[0].language, ordinals: units.map(unit => unit.ordinal) };
  };
  const read = (target: ProvisionTarget) => {
    const { start, end, units, articleTitle, sectionTitle } = range(target);
    const text = partsFor(units).join("\n\n");
    const adjacentPositions: { next?: string; previous?: string } = {};
    if (articleTitle !== null) {
      const hierarchy = source.units[start].hierarchy;
      const sameChapter = (index: number) => ancestor(hierarchy, source.units[index].hierarchy)
        && ancestor(source.units[index].hierarchy, hierarchy);
      if (end < source.units.length && structure[end].heading && sameChapter(end)) {
        adjacentPositions.next = source.units[end].locator;
      }
      for (let index = start - 1; index >= 0 && sameChapter(index); index--) {
        if (structure[index].heading) {
          adjacentPositions.previous = source.units[index].locator;
          break;
        }
      }
    }
    // Citation metadata must depend on the immutable range, not the candidate
    // position that happened to select it. Several matches can share this key.
    const anchor = units[0];
    const context = annexContext(start, end);
    const sourceStructure = {
      navigationOnly: true as const,
      rangeKind: articleTitle !== null ? "article" as const : sectionTitle !== null ? "stored_section" as const : "document" as const,
      rangeTitle: articleTitle ?? sectionTitle,
      anchor: { position: anchor.locator, ordinal: anchor.ordinal, language: anchor.language },
      ...(context.length ? { annexContext: context } : {}),
      headings: units.filter((unit, offset) => structure[start + offset].heading
        || unit.hierarchy.some(heading => heading.trim() === unit.text.trim()))
        .map(unit => ({ position: unit.locator, ordinal: unit.ordinal, language: unit.language,
          text: unit.text, hierarchy: [...unit.hierarchy] })),
    };
    return { text, title: source.title, articleTitle, sectionTitle, position: units[0].locator, sourceStructure,
      language: units[0].language, ordinals: units.map(unit => unit.ordinal), adjacentPositions };
  };
  const firstArticle = (target: ProvisionTarget): string | null => {
    const parent = range(target);
    if (parent.articleTitle === null) return null;
    let enclosing: ReturnType<typeof range> | undefined;
    const hierarchy = source.units[parent.start].hierarchy;
    for (let index = 0; index < parent.start; index++) {
      const unit = source.units[index];
      if (!unit.hierarchy.length || !ancestor(unit.hierarchy, hierarchy)
        || unit.text.trim() !== unit.hierarchy.at(-1)!.trim()
        || positions.get(unit.locator)?.length !== 1 || unit.language !== target.language) continue;
      try {
        const section = range({ ...target, position: unit.locator, wholeSection: true, wholeDocument: false });
        if (section.sectionTitle && section.start <= parent.start && section.end >= parent.end
          && (!enclosing || section.end - section.start < enclosing.end - enclosing.start)) enclosing = section;
      } catch { /* Ambiguous structural containers do not authorize another read. */ }
    }
    if (!enclosing) return null;
    const index = source.units.findIndex((unit, index) => index > enclosing.start && index < enclosing.end
      && structure[index].heading);
    if (index < 0 || index === parent.start) return null;
    const first = source.units[index], sectionHierarchy = source.units[enclosing.start].hierarchy;
    // A nested subsection is not an introductory article of its parent section.
    if (first.language !== target.language || positions.get(first.locator)?.length !== 1
      || !ancestor(sectionHierarchy, first.hierarchy) || !ancestor(first.hierarchy, sectionHierarchy)) return null;
    const complete = range({ ...target, position: first.locator, wholeSection: false, wholeDocument: false });
    return complete.articleTitle && complete.start === index && complete.end <= enclosing.end ? first.locator : null;
  };
  // Raw headings also count when broken quotation boundaries prevent a safe
  // article read. Such documents still require an explicit broader selection.
  const hasArticleHeadings = source.units.some(unit => articleNumberFromHeading(unit.text) !== undefined);
  return Object.assign(read, { describe, firstArticle, hasArticleHeadings });
}
