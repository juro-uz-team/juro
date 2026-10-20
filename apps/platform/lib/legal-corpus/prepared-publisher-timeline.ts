import {parse,type DefaultTreeAdapterTypes} from "parse5";
import {classifyLegalSourceUrl} from "../legal/source-fetch";

type Node=DefaultTreeAdapterTypes.Node;
function text(node:Node):string{
  if(node.nodeName==="#text")return (node as DefaultTreeAdapterTypes.TextNode).value;
  return "childNodes" in node?node.childNodes.map(text).join(""):"";
}
function calendarDate(value:string){
  const match=/^(\d{2})\.(\d{2})\.(\d{4})(?: \d{2})?$/u.exec(value.trim());
  if(!match)throw Error("PREPARED_EDITORIAL_DATE_INVALID");
  const [,day,month,year]=match,iso=`${year}-${month}-${day}`;
  // These retained publisher timelines use modern Uzbekistan civil dates.
  // Earlier offset regimes require a separately qualified date policy.
  // IANA asia: Asia/Tashkent and Asia/Samarkand use fixed +05 from 1992.
  // https://data.iana.org/time-zones/tzdb/asia
  if(Number(year)<1992||new Date(`${iso}T00:00:00Z`).toISOString().slice(0,10)!==iso){
    throw Error("PREPARED_EDITORIAL_DATE_INVALID");
  }
  return iso;
}
function startOfDay(date:string){return new Date(`${date}T00:00:00+05:00`).toISOString();}

/** Parse explicit publisher revision controls, never a requested ONDATE alone.
 * This establishes editorial coverage only, not legal applicability. The caller
 * must authenticate the raw bytes against the normalized parent's source hash. */
export function readPreparedPublisherTimeline(html:string,officialUrl:string){
  const reference=classifyLegalSourceUrl(officialUrl);
  if(reference.sourceKind!=="lex")throw Error("PREPARED_EDITORIAL_SOURCE_INVALID");
  const selected=new Set<string>(),dates=new Set<string>(),multipleEditions=new Set<string>();
  function visit(node:Node){
    if("attrs" in node){
      const attributes=new Map(node.attrs.map(item=>[item.name,item.value]));
      const classes=new Set((attributes.get("class")??"").split(/\s+/u));
      if(classes.has("lx_date_selected")){
        const label=text(node).trim();
        if(!/^\d{2}\.\d{2}\.\d{4}$/u.test(label))throw Error("PREPARED_EDITORIAL_SELECTION_INVALID");
        selected.add(calendarDate(label));
      }
      if(classes.has("lx_date_link")){
        const call=/^lxOpenUrl\('([^']+)'\);?$/u.exec((attributes.get("onclick")??"").trim());
        if(!call)throw Error("PREPARED_EDITORIAL_CONTROL_INVALID");
        const url=new URL(call[1]!,officialUrl),entries=[...url.searchParams];
        const revision=entries.length===1&&entries[0]![0]==="ONDATE";
        const sourceUrl=new URL(url);if(!revision)sourceUrl.search="";
        const target=classifyLegalSourceUrl(sourceUrl.href);
        if(target.host!==reference.host||target.canonicalId!==reference.canonicalId||target.locale!==reference.locale){
          throw Error("PREPARED_EDITORIAL_SOURCE_INVALID");
        }
        // Comparison menus repeat dates; the undated current-version shortcut
        // also supplies no revision boundary. Reject other unknown controls.
        if(revision){
          const date=calendarDate(text(node));
          if(/\s\d{2}$/u.test(text(node).trim()))multipleEditions.add(date);
          if(target.revisionDate!==date)throw Error("PREPARED_EDITORIAL_DATE_INVALID");
          dates.add(date);
        }else if(!(entries.length===0&&!/\d/u.test(text(node)))
          &&!(url.searchParams.get("action")==="compare"&&entries.every(([key])=>["ONDATE","ONDATE2","action"].includes(key)))){
          throw Error("PREPARED_EDITORIAL_CONTROL_INVALID");
        }
      }
    }
    if("childNodes" in node)for(const child of node.childNodes)visit(child);
  }
  visit(parse(html));
  if(selected.size!==1)throw Error("PREPARED_EDITORIAL_SELECTION_INVALID");
  const selectedDate=[...selected][0]!;
  if(multipleEditions.has(selectedDate))throw Error("PREPARED_EDITORIAL_SELECTION_INVALID");
  if(reference.revisionDate&&reference.revisionDate!==selectedDate)throw Error("PREPARED_EDITORIAL_SELECTION_INVALID");
  dates.add(selectedDate);
  if(dates.size<2)throw Error("PREPARED_EDITORIAL_TIMELINE_UNAVAILABLE");
  const nextDate=[...dates].filter(date=>date>selectedDate).sort()[0]??null;
  return {selectedDate,nextDate,from:startOfDay(selectedDate),to:nextDate?startOfDay(nextDate):null};
}
