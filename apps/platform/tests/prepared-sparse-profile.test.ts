import assert from "node:assert/strict";
import test from "node:test";
import {buildCustomBm25IntermediateRecords,CUSTOM_BM25_FIELDS,scoreCustomBm25Term} from "../lib/legal-corpus/custom-bm25";
import {prepareSparseProfile,type PreparedSparseFields} from "../lib/legal-corpus/prepared-sparse-profile";

test("weighted lexical profiles reproduce expanded legal-membership statistics and scores",async()=>{
  const sources:Array<{fields:PreparedSparseFields;members:number}>=[
    {fields:{title:"МЕҲНАТ ҳуқуқи",hierarchy:"Общие положения",article:"Статья 161",text:"Меҳнат меҳнат ҳуқуқи １６１"},members:7},
    {fields:{title:"МЕҲНАТ ҳуқуқи",hierarchy:"Исключения",article:"Статья 409",text:"Меҳнат меҳнат ҳуқуқи １６１"},members:2},
    {fields:{title:"O‘zbekiston",hierarchy:"",article:"",text:"ish haqi ish"},members:1},
  ];
  const profiles=sources.map(source=>prepareSparseProfile(source.fields,source.members));
  assert.notEqual(profiles[0]!.identity,profiles[1]!.identity,"structure survives identical embedding text");
  const expanded:Array<Awaited<ReturnType<typeof buildCustomBm25IntermediateRecords>>>=[];
  for(const source of sources)for(let index=0;index<source.members;index++)expanded.push(
    await buildCustomBm25IntermediateRecords({segmentId:"fixture",itemKey:`item-${expanded.length}`,language:"ru",
      documentType:"law",validFromEpoch:0,validToEpoch:null,fields:source.fields},expanded.length));
  const actualDf=new Map<string,number>(),weightedDf=new Map<string,number>();
  for(const row of expanded)for(const hash of new Set(row.records.map(record=>record.termHash)))actualDf.set(hash,(actualDf.get(hash)??0)+1);
  for(const row of profiles)for(const posting of row.postings)weightedDf.set(posting.termHash,(weightedDf.get(posting.termHash)??0)+posting.documentFrequencyContribution);
  assert.deepEqual([...weightedDf].sort(),[...actualDf].sort());
  const documentCount=profiles.reduce((sum,row)=>sum+row.members,0);
  assert.equal(documentCount,expanded.length);
  for(const field of CUSTOM_BM25_FIELDS){
    const weightedLength=profiles.reduce((sum,row)=>sum+row.weightedFieldLengths[field],0);
    const expandedLength=expanded.reduce((sum,row)=>sum+row.fieldLengths[field],0);
    assert.equal(weightedLength,expandedLength);
    let ordinal=0;
    for(const profile of profiles){
      const reference=expanded[ordinal]!;
      for(const posting of profile.postings){
        const record=reference.records.find(record=>record.termHash===posting.termHash&&record.field===field);
        const score=scoreCustomBm25Term({termFrequency:posting.termFrequencies[field],documentFrequency:weightedDf.get(posting.termHash)!,
          documentCount,fieldLength:profile.fieldLengths[field],averageFieldLength:weightedLength/documentCount,field});
        const expected=scoreCustomBm25Term({termFrequency:record?.termFrequency??0,documentFrequency:actualDf.get(posting.termHash)!,
          documentCount:expanded.length,fieldLength:reference.fieldLengths[field],averageFieldLength:expandedLength/expanded.length,field});
        assert.equal(score,expected);
      }
      ordinal+=profile.members;
    }
  }
});

test("profile identity excludes multiplicity but preserves every structural field",()=>{
  const fields={title:"Act",hierarchy:"Part I",article:"",text:"rule rule"};
  assert.equal(prepareSparseProfile(fields,1).identity,prepareSparseProfile(fields,100).identity);
  for(const members of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>prepareSparseProfile(fields,members));
  assert.throws(()=>prepareSparseProfile(fields,Number.MAX_SAFE_INTEGER),/OVERFLOW/);
});
