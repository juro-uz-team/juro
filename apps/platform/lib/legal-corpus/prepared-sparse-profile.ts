import {createHash} from "node:crypto";
import {analyzeCustomWordTerms,CUSTOM_BM25_FIELDS} from "./custom-bm25";

type Field = typeof CUSTOM_BM25_FIELDS[number];
export type PreparedSparseFields = Record<Field,string>;

/** One lexical profile can represent many legal memberships. Its posting is
 * stored once, but corpus statistics count every represented membership.
 * Group only identical fields; compact embedding identity omits structure and
 * cannot establish lexical equivalence. This is discovery, not applicability. */
export function prepareSparseProfile(fields:PreparedSparseFields,members:number){
  if(!Number.isSafeInteger(members)||members<1)throw Error("PREPARED_SPARSE_MULTIPLICITY_INVALID");
  if(Object.keys(fields).length!==CUSTOM_BM25_FIELDS.length
    ||CUSTOM_BM25_FIELDS.some(field=>typeof fields[field]!=="string"))throw Error("PREPARED_SPARSE_FIELDS_INVALID");
  const fieldLengths:Record<Field,number>={title:0,hierarchy:0,article:0,text:0};
  const terms=new Map<string,Record<Field,number>>();
  for(const field of CUSTOM_BM25_FIELDS){
    const tokens=analyzeCustomWordTerms(fields[field]);fieldLengths[field]=tokens.length;
    if(!Number.isSafeInteger(tokens.length*members))throw Error("PREPARED_SPARSE_STATISTICS_OVERFLOW");
    for(const token of tokens){
      let counts=terms.get(token);
      if(!counts){counts={title:0,hierarchy:0,article:0,text:0};terms.set(token,counts);}
      counts[field]++;
    }
  }
  const identity=createHash("sha256").update(JSON.stringify([
    "prepared-sparse-profile-v1",...CUSTOM_BM25_FIELDS.map(field=>fields[field]),
  ])).digest("hex");
  return {identity,members,fieldLengths,
    weightedFieldLengths:Object.fromEntries(CUSTOM_BM25_FIELDS.map(field=>[field,fieldLengths[field]*members])) as Record<Field,number>,
    postings:[...terms].map(([term,termFrequencies])=>({
      termHash:createHash("sha256").update(`word-v1\0${term}`).digest("hex"),
      termFrequencies,
      // Count a document once even when the word appears in several fields.
      documentFrequencyContribution:members,
    })).sort((left,right)=>left.termHash<right.termHash?-1:left.termHash>right.termHash?1:0)};
}
