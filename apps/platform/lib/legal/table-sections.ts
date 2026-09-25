import type {NormalizedLegalSourceSnapshot} from "./source-parser";

type Block=NormalizedLegalSourceSnapshot["blocks"][number];

/** A publisher's full-width Roman heading can divide a long annex table.
 * Keep the original column header and every cell in each section. Merged
 * rows and unfamiliar layouts remain unavailable until their relationships
 * can be represented without losing context. */
export function completeTableSectionTexts(blocks:readonly Block[],prefix:readonly string[]):string[]|null {
  const tables=blocks.flatMap((block,index)=>block.tableRows?[index]:[]);
  if(tables.length!==1)return null;
  const index=tables[0]!,rows=blocks[index]!.tableRows!,header=rows[0]!;
  if(header.length<2||header.some(cell=>cell.colSpan!==1||cell.rowSpan!==1)
    ||! /^(?:T\/r|Т\/р|№)$/iu.test(header[0]!.text.trim())
    ||rows.some(row=>row.some(cell=>cell.rowSpan!==1)))return null;
  const width=header.length;
  if(rows.some(row=>row.reduce((sum,cell)=>sum+cell.colSpan,0)!==width))return null;
  if(rows.some(row=>row.length!==1&&row.some(cell=>cell.colSpan!==1)))return null;
  const boundaries=rows.flatMap((row,index)=>row.length===1&&row[0]!.colSpan===width
    &&/^[IVXLCDM]+\.\s/u.test(row[0]!.text)?[index]:[]);
  if(boundaries.length<2)return null;
  const render=(row:typeof header)=>row.map(cell=>cell.text).join(" | ");
  const introduction=[...prefix,...blocks.slice(0,index).map(block=>block.text),...rows.slice(0,boundaries[0]).map(render)];
  const footer=blocks.slice(index+1).map(block=>block.text);
  return boundaries.map((start,index)=>[...introduction,...rows.slice(start,boundaries[index+1]).map(render),...footer]
    .join(" ").replace(/\s+/gu," ").trim());
}
