type AnalyticsPayload = Record<string, string | number | boolean | undefined>;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function trackPublicEvent(event: string, payload: AnalyticsPayload = {}): void {
  if (typeof window === "undefined") return;
  try {
    if (window.localStorage.getItem("juro-cookie-consent") !== "analytics") return;
  } catch {
    return;
  }
  const safePayload = Object.fromEntries(
    Object.entries(payload).filter(([key, value]) =>
      !/text|content|document|email|phone|name|otp/i.test(key) &&
      ["string", "number", "boolean"].includes(typeof value),
    ),
  );
  window.dataLayer?.push({ event, ...safePayload });
}

export function trackProductPage():void{
 if(typeof window==="undefined"||navigator.doNotTrack==="1")return;
 try{
  if(localStorage.getItem("juro-cookie-consent")!=="analytics")return;
  if(location.hostname.includes("staging")||location.hostname.includes("localhost"))return;
  const visitorId=localStorage.getItem("juro-analytics-visitor")??crypto.randomUUID();localStorage.setItem("juro-analytics-visitor",visitorId);
  const old=JSON.parse(sessionStorage.getItem("juro-analytics-session")??"null");const sessionId=old&&Date.now()-old.time<1800000?old.id:crypto.randomUUID();sessionStorage.setItem("juro-analytics-session",JSON.stringify({id:sessionId,time:Date.now()}));
  const query=new URLSearchParams(location.search);const clean=(v:string|null)=>v&&/^[a-zA-Z0-9._ -]+$/.test(v)?v.slice(0,80):undefined;
  const page=location.pathname.replace(/[0-9a-f-]{36}/g,"_id");if(!/^\/[a-zA-Z0-9/_-]*$/.test(page))return;
  void fetch("/api/product-events",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:crypto.randomUUID(),event:"page_view",application:"website",visitorId,sessionId,page,source:clean(query.get("utm_source")),medium:clean(query.get("utm_medium")),campaign:clean(query.get("utm_campaign")),device:innerWidth<700?"mobile":innerWidth<1100?"tablet":"desktop",consent:true}),keepalive:true}).catch(()=>{});
 }catch{}
}
