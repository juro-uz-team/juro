import {ApiAuthError} from "../auth/safe-write";
import {database} from '../storage/connection';
import {DOCUMENT_CATEGORIES} from '../document-builder/registry/categories';
import type {DocumentCategory,DocumentDefinition} from '../document-builder/registry/types';
import { workspaceEntitlements, type WorkspaceEntitlements } from "../billing/entitlements";
import { requireD1 } from "../document-builder/storage/runtime";
export async function resolvedCategories():Promise<DocumentCategory[]>{const rows=(await database().pool.query('SELECT * FROM control_template_categories ORDER BY position,slug')).rows;const categories=new Map<string,DocumentCategory>(DOCUMENT_CATEGORIES.map(v=>[v.slug,v]));for(const r of rows){if(!r.active)categories.delete(r.slug);else categories.set(r.slug,{code:'99',slug:r.slug,title:{ru:r.title_ru,uz:r.title_uz},description:{ru:'',uz:''},icon:categories.get(r.slug)?.icon??'FileText'});}return [...categories.values()];}
export function templateAvailableOnPlan(definition: DocumentDefinition, plan: WorkspaceEntitlements["planCode"]) {
  if (definition.allowedPlans?.length) {
    const legacy = { starter: "individual", advanced: "individual", company: "business", lawyer: "legal_team" } as const;
    return definition.allowedPlans.includes(plan)
      || (Object.hasOwn(legacy, plan) && definition.allowedPlans.includes(legacy[plan as keyof typeof legacy]));
  }
  return plan !== "free" || definition.popular;
}

export async function assertTemplatePlan(definition: DocumentDefinition, workspaceId: string, db = requireD1()) {
  const terms = await workspaceEntitlements(db, workspaceId);
  if (terms.readOnly || !templateAvailableOnPlan(definition, terms.planCode)) {
    throw new ApiAuthError("Шаблон недоступен на текущем тарифе.", 403);
  }
}
