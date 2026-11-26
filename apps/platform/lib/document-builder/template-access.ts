import { workspaceEntitlements, type WorkspaceEntitlements } from "../billing/entitlements";
import { SubscriptionLimitError } from "../billing/usage";
import type { BuilderLanguage } from "./registry/engine";
import { publishedDefinitions, resolvedDocument } from "./registry/published";
import type { DocumentDefinition, DocumentLibraryItem } from "./registry/types";
import { requireD1 } from "./storage/runtime";

export type WorkspaceLibraryItem = DocumentLibraryItem & { languages: readonly BuilderLanguage[] };

export function templateLanguages(definition: DocumentDefinition): BuilderLanguage[] {
  const paragraphs = definition.generationSchema.paragraphs.filter(paragraph => paragraph.kind !== "spacer");
  return (["ru", "uz"] as const).filter(language =>
    paragraphs.length > 0 && paragraphs.every(paragraph => Boolean(paragraph.text[language]?.trim())));
}

export function templateAvailableOnPlan(definition: DocumentDefinition, plan: WorkspaceEntitlements["planCode"]) {
  if (definition.status !== "published") return false;
  if (definition.allowedPlans?.length) {
    const legacy = { starter: "individual", advanced: "individual", company: "business", lawyer: "legal_team" } as const;
    return definition.allowedPlans.includes(plan)
      || (Object.hasOwn(legacy, plan) && definition.allowedPlans.includes(legacy[plan as keyof typeof legacy]));
  }
  return plan !== "free" || definition.popular;
}

export function templatesOnPlan(definitions: readonly DocumentDefinition[], plan: WorkspaceEntitlements["planCode"]): WorkspaceLibraryItem[] {
  return definitions.flatMap(definition => {
    if (!templateAvailableOnPlan(definition, plan)) return [];
    const languages = templateLanguages(definition);
    if (languages.length === 0) return [];
    const { code, categorySlug, titleRu, titleUz, descriptionRu, descriptionUz, status, editorialStatus, estimatedMinutes, popular } = definition;
    return [{ code, categorySlug, titleRu, titleUz, descriptionRu, descriptionUz, status, editorialStatus, estimatedMinutes, popular, languages }];
  });
}

export async function workspaceTemplateLibrary(terms: WorkspaceEntitlements | null) {
  return terms?.readOnly ? [] : templatesOnPlan(await publishedDefinitions(), terms?.planCode ?? "free");
}

export async function assertTemplatePlan(code: string, language: BuilderLanguage, workspaceId: string, db = requireD1()) {
  const [definition, terms] = await Promise.all([resolvedDocument(code, undefined, db), workspaceEntitlements(db, workspaceId)]);
  if (!definition || terms.readOnly || !templateAvailableOnPlan(definition, terms.planCode) || !templateLanguages(definition).includes(language)) {
    throw new SubscriptionLimitError("TEMPLATE_PLAN_UNAVAILABLE");
  }
}
