import assert from "node:assert/strict";
import test from "node:test";
import {completedInitialResearch} from "../lib/legal-chat/streamed-initial-research";

test("initial discovery exposes only complete interpretation and complete query objects",()=>{
  const interpretation={topics:['Quoted "title" and [brackets]'],facts:[],temporal:{kind:"current"},questions:[]};
  const first={text:'escaped \"name\" {rule}',topicIndices:[0]},second={text:"underlying rule",topicIndices:[0]};
  const text=JSON.stringify({interpretation,research:{directQueries:[first],underlyingRuleQueries:[second]}});
  for(let index=0;index<=text.length;index++) {
    const value=completedInitialResearch(text.slice(0,index));
    if(value){assert.deepEqual(value.interpretation,interpretation);
      const expected=[first,second].filter(query=>text.slice(0,index).includes(JSON.stringify(query)));
      assert.deepEqual(value.queries,expected);}
  }
  assert.deepEqual(completedInitialResearch(text),{interpretation,queries:[first,second]});
});

test("unexpected initial field order does not speculate; oversized output is rejected",()=>{
  assert.equal(completedInitialResearch('{"research":{"directQueries":['),null);
  assert.throws(()=>completedInitialResearch(" ".repeat(256001)),/OUTPUT_EXCEEDED/);
});
