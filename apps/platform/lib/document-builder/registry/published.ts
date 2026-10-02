import {withStandardCollaboration} from "./collaboration";
import { z } from "zod";
import { database } from "../../storage/connection";
import { DOCUMENT_REGISTRY, getDocumentByCode } from "./catalog";
import { DOCUMENT_CATEGORIES } from "./categories";
import type { DocumentDefinition, DocumentLibraryItem } from "./types";
const localized=z.object({ru:z.string().min(1).max(10000),uz:z.string().min(1).max(10000),"uz-cyrl":z.string().optional(),en:z.string().optional()});
const condition=z.object({field:z.string().max(100),operator:z.enum(["equals","not-equals","includes","truthy","falsy","filled","empty"]),value:z.union([z.string(),z.number(),z.boolean()]).optional()});
export function validateTemplate(input:unknown):DocumentDefinition {
 const definition=z.object({id:z.string().max(160),code:z.string().regex(/^\d{7}$/),categoryCode:z.string().regex(/^\d{2}$/),subcategoryCode:z.string().regex(/^\d{2}$/),documentCode:z.string().regex(/^\d{3}$/),slug:z.string().regex(/^[a-z0-9-]+$/),categorySlug:z.string().regex(/^[a-z0-9-]{1,80}$/),allowedPlans:z.array(z.string().regex(/^[a-z0-9_-]{1,80}$/)).max(30).optional(),titleRu:z.string().min(1).max(300),titleUz:z.string().min(1).max(300),descriptionRu:z.string().max(4000),descriptionUz:z.string().max(4000),version:z.string().max(80),status:z.enum(["draft","review","published","archived"]),editorialStatus:z.enum(["Draft","Legal Review","Translation Review","Technical Review","Published","Archived"]),questionnaire:z.array(z.object({id:z.string(),title:localized,fields:z.array(z.record(z.string(),z.unknown())).max(100)}).passthrough()).max(40),generationSchema:z.object({fileName:localized,paragraphs:z.array(z.object({id:z.string(),kind:z.enum(["title","subtitle","heading","body","list","signature","spacer"]),text:z.object({ru:z.string().max(10000),uz:z.string().max(10000),en:z.string().optional(),"uz-cyrl":z.string().optional()}),condition:condition.optional(),repeatFor:z.string().optional()})).max(1000)})}).passthrough().parse(input);
 if(definition.categoryCode+definition.subcategoryCode+definition.documentCode!==definition.code)throw Error("INVALID_CATEGORY_OR_CODE");
 const fieldTypes=new Set(["short-text","long-text","full-name","pinfl","passport","company-name","tin","bank-details","address","phone","email","date","duration","money","currency","percent","number","radio","checkbox","select","multiselect","table","repeatable-group","file","party-natural-person","party-legal-entity","representative","witnesses","clause-choice"]);
 const ids=new Set<string>();
 function fields(values:Record<string,unknown>[],depth=0,prefix=""){if(depth>6)throw Error("FIELDS_TOO_DEEP");for(const f of values){if(typeof f.id!=="string"||!/^[-a-zA-Z0-9_.]+$/.test(f.id)||ids.has(prefix+f.id)||!fieldTypes.has(String(f.type)))throw Error("INVALID_FIELD");ids.add(prefix+f.id);localized.parse(f.label);if(f.condition)condition.parse(f.condition);if(f.fields)fields(z.array(z.record(z.string(),z.unknown())).parse(f.fields),depth+1,prefix+f.id+".");if(f.columns)fields(z.array(z.record(z.string(),z.unknown())).parse(f.columns),depth+1,prefix+f.id+".");}}
 for(const step of definition.questionnaire)fields(step.fields);
 return withStandardCollaboration(definition as unknown as DocumentDefinition);
}
export async function resolvedDocument(code:string,version?:string):Promise<DocumentDefinition|undefined>{
 const rows=await database().pool.query(`SELECT definition FROM control_template_versions WHERE code=$1 AND published_at IS NOT NULL ${version?"AND version=$2":""} ORDER BY published_at DESC LIMIT 1`,version?[code,version]:[code]);
 const definition=rows.rows[0]?.definition??getDocumentByCode(code);return definition?withStandardCollaboration(definition):undefined;
}
export async function resolvedLibrary():Promise<DocumentLibraryItem[]>{
 const rows=await database().pool.query("SELECT DISTINCT ON(code) definition FROM control_template_versions WHERE published_at IS NOT NULL ORDER BY code,published_at DESC");
 const documents=new Map(DOCUMENT_REGISTRY.map(d=>[d.code,d]));for(const row of rows.rows)documents.set(row.definition.code,row.definition);
 return [...documents.values()].filter(d=>d.status==="published").map(d=>({code:d.code,categorySlug:d.categorySlug,titleRu:d.titleRu,titleUz:d.titleUz,descriptionRu:d.descriptionRu,descriptionUz:d.descriptionUz,status:d.status,editorialStatus:d.editorialStatus,estimatedMinutes:d.estimatedMinutes,popular:d.popular}));
}
