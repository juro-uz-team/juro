import {database} from '../storage/connection';
import {DOCUMENT_CATEGORIES} from '../document-builder/registry/categories';
import type {DocumentCategory} from '../document-builder/registry/types';
export async function resolvedCategories():Promise<DocumentCategory[]>{const rows=(await database().pool.query('SELECT * FROM control_template_categories ORDER BY position,slug')).rows;const categories=new Map<string,DocumentCategory>(DOCUMENT_CATEGORIES.map(v=>[v.slug,v]));for(const r of rows){if(!r.active)categories.delete(r.slug);else categories.set(r.slug,{code:'99',slug:r.slug,title:{ru:r.title_ru,uz:r.title_uz},description:{ru:'',uz:''},icon:categories.get(r.slug)?.icon??'FileText'});}return [...categories.values()];}
