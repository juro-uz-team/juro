import {database} from "../storage/connection";
import {z} from "zod";
export async function publishedSiteContent(locale:string,kind:string){
 const input=z.object({locale:z.enum(["ru","uz","en"]),kind:z.enum(["faq","news","page"])}).parse({locale,kind});
 return (await database().pool.query(`SELECT c.slug,c.kind,c.locale,c.position,v.title,v.description,v.body,v.image,v.seo_title,v.seo_description FROM control_site_content c JOIN control_site_content_versions v ON v.id=c.published_version_id WHERE c.locale=$1 AND c.kind=$2 ORDER BY c.position,c.created_at`,[input.locale,input.kind])).rows;
}
export const siteContentMutation=z.discriminatedUnion("action",[
 z.object({action:z.literal("save_draft"),id:z.string().uuid().optional(),kind:z.enum(["faq","news","page"]),slug:z.string().regex(/^[a-z0-9-]{1,120}$/),locale:z.enum(["ru","uz","en"]),position:z.number().int().min(0).max(10000),title:z.string().trim().min(1).max(300),description:z.string().max(500),body:z.string().max(20000),image:z.string().regex(/^\/[-a-zA-Z0-9/_.]+$/).nullable(),seoTitle:z.string().max(300),seoDescription:z.string().max(500)}).strict(),
 z.object({action:z.enum(["publish","unpublish"]),id:z.string().uuid(),versionId:z.string().uuid().optional()}).strict()
]);
