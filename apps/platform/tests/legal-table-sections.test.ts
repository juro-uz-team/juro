import assert from "node:assert/strict";
import test from "node:test";
import {completeTableSectionTexts} from "../lib/legal/table-sections";
import type {NormalizedLegalSourceSnapshot} from "../lib/legal/source-parser";

test("table sections retain headers, subordinate full-width qualifiers, cells and footnotes",()=>{
  const cell=(text:string,colSpan=1,rowSpan=1)=>({text,colSpan,rowSpan});
  const rows=[[cell("T/r"),cell("Body"),cell("Office")],[cell("I. First scope",3)],
    [cell("Only pending cases",3)],[cell("1."),cell("First body"),cell("First office")],
    [cell("II. Second scope",3)],[cell("2."),cell("Second body"),cell("Second office")]];
  const blocks:NormalizedLegalSourceSnapshot["blocks"]=[{index:0,kind:"paragraph",text:"Official annex"},
    {index:1,kind:"paragraph",text:"Flattened table",tableRows:rows},{index:2,kind:"paragraph",text:"Exception applies to both scopes."}];
  const parts=completeTableSectionTexts(blocks,["Adoption and instrument context."]);
  assert.equal(parts?.length,2);assert.match(parts![0]!,/T\/r \| Body \| Office/);
  assert.match(parts![0]!,/Only pending cases/);assert.doesNotMatch(parts![1]!,/First body/);
  assert.ok(parts!.every(part=>part.includes("Exception applies")&&part.includes("Adoption and instrument")));
  rows[3]=[cell("1."),cell("Ambiguous merged value",2)];
  assert.equal(completeTableSectionTexts(blocks,[]),null);
  rows[3]=[cell("1."),cell("First body",1,2),cell("First office")];
  assert.equal(completeTableSectionTexts(blocks,[]),null);
});
