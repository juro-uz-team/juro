import assert from "node:assert/strict";
import test from "node:test";
import {readPreparedPublisherTimeline} from "../lib/legal-corpus/prepared-publisher-timeline";

const url="https://lex.uz/ru/docs/145261?ONDATE=30.10.2021";
const selected='<div class="dropdown-menu__item lx_date_selected stopProp">30.10.2021</div>';
const link=(date:string,label=date)=>`<div class="lx_date_link" onclick="lxOpenUrl('/ru/docs/145261?ONDATE=${date}')">${label}</div>`;
const html=selected+`<div class="lx_date_link" onclick="lxOpenUrl('/ru/docs/145261')">Текущая версия</div>`
  +link("01.04.1996")+link("10.02.2022")+link("18.05.2022")
  +link("10.01.2018 04")+`<div class="lx_date_link" onclick="lxOpenUrl('/ru/docs/145261?ONDATE=30.10.2021&action=compare')">Текущая версия</div>`;

test("publisher editorial interval comes from explicit selected and adjacent revisions in Uzbekistan time",()=>{
  assert.deepEqual(readPreparedPublisherTimeline(html+html,url),{selectedDate:"2021-10-30",nextDate:"2022-02-10",
    from:"2021-10-29T19:00:00.000Z",to:"2022-02-09T19:00:00.000Z"});
});

test("equivalent handlers retain the nearest successor and unknown controls fail closed",()=>{
  const semicolon=html.replace("ONDATE=10.02.2022')","ONDATE=10.02.2022');");
  assert.equal(readPreparedPublisherTimeline(semicolon,url).nextDate,"2022-02-10");
  for(const content of [
    html.replace("lxOpenUrl('/ru/docs/145261?ONDATE=10.02.2022')","unknownHandler()"),
    html.replace("ONDATE=10.02.2022","ONDATE=10.02.2022&unknown=1"),
  ])assert.throws(()=>readPreparedPublisherTimeline(content,url),/CONTROL_INVALID/);
});

test("requested dates and ambiguous or malformed publisher controls cannot establish a timeline",()=>{
  for(const content of ["<p>30.10.2021</p>",selected,html+selected.replaceAll("30.10.2021","31.10.2021"),
    html.replaceAll("10.02.2022","31.02.2022"),html+link("30.10.2021 02"),
    html.replace("10.02.2022')","10.02.2023')"),html.replaceAll("/ru/docs/145261","/ru/docs/123"),
    html.replaceAll("01.04.1996","01.04.1991")]){
    assert.throws(()=>readPreparedPublisherTimeline(content,url));
  }
  assert.throws(()=>readPreparedPublisherTimeline(html,url.replace("30.10.2021","01.01.2022")),/SELECTION_INVALID/);
});
