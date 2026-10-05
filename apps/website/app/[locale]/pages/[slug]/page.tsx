import {notFound} from "next/navigation";
import {publishedArticles} from "../../../../lib/site-content";
export const dynamic="force-dynamic";
async function article(params:Promise<{locale:string;slug:string}>){const {locale,slug}=await params;if(locale!=="ru"&&locale!=="uz"&&locale!=="en")notFound();const found=(await publishedArticles(locale,"page")).find(p=>p.slug===slug);if(!found)notFound();return {locale,found};}
export async function generateMetadata({params}:{params:Promise<{locale:string;slug:string}>}){const {found}=await article(params);return {title:found.seo_title||found.title,description:found.seo_description||found.description};}
export default async function ContentPage({params}:{params:Promise<{locale:string;slug:string}>}){const {locale,found}=await article(params);return <main style={{maxWidth:920,margin:"64px auto",padding:24}}><a href={`/${locale}`}>JURO</a><h1>{found.title}</h1><p>{found.description}</p><div style={{whiteSpace:"pre-wrap",lineHeight:1.7}}>{found.body}</div></main>;}
