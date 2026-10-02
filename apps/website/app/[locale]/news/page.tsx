import {notFound} from "next/navigation";
import {publishedArticles} from "../../../lib/site-content";
export const dynamic="force-dynamic";
export default async function News({params}:{params:Promise<{locale:string}>}){
 const {locale}=await params;if(locale!=="ru"&&locale!=="uz"&&locale!=="en")notFound();
 const articles=await publishedArticles(locale,"news");
 return <main style={{maxWidth:920,margin:"64px auto",padding:24}}><a href={`/${locale}`}>JURO</a><h1>{locale==="ru"?"Новости JURO":locale==="uz"?"JURO yangiliklari":"JURO news"}</h1>{articles.length?articles.map(a=><article key={a.slug} style={{borderBottom:"1px solid #d9dee1",padding:"32px 0"}}><h2>{a.title}</h2><p>{a.description}</p><div style={{whiteSpace:"pre-wrap",lineHeight:1.7}}>{a.body}</div></article>):<p>{locale==="ru"?"Пока нет опубликованных новостей.":locale==="uz"?"Hozircha yangiliklar yo‘q.":"No published news yet."}</p>}</main>;
}
