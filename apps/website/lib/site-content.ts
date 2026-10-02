import type {PublicLanguage} from "../content/types";
export type SiteArticle={slug:string;title:string;description:string;body:string;image:string|null;seo_title:string|null;seo_description:string|null};
export async function publishedArticles(locale:PublicLanguage,kind:"news"|"page"):Promise<SiteArticle[]>{
 try{
  const query=new URLSearchParams({locale,kind});
  const r=await fetch(`http://localhost:${process.env.PORT??3000}/api/internal/admin/site-content/published?${query}`,{headers:{"x-juro-admin-internal-token":process.env.ADMIN_INTERNAL_TOKEN??""},cache:"no-store",signal:AbortSignal.timeout(5000)});
  return r.ok?await r.json():[];
 }catch{return [];}
}
