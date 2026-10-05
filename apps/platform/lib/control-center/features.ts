import {database} from "../storage/connection";
export const controlFeatures={legal_chat:"AI-чат",document_analysis:"Анализ документов",document_comparison:"Сравнение документов",document_builder:"Конструктор документов",consultations:"Обращения к специалистам"} as const;
export async function controlFeatureUnavailable(path:string,method:string){
 if(!["POST","PATCH","PUT"].includes(method))return false;
 let key: keyof typeof controlFeatures | undefined;
 if(["/api/platform/ai","/api/guest/ai","/api/platform/ai/intake"].includes(path))key="legal_chat";
 else if(path.startsWith("/api/platform/document-analysis")||path==="/api/document-builder/attachment-analysis")key="document_analysis";
 else if(path.startsWith("/api/platform/document-comparisons"))key="document_comparison";
 else if(path.startsWith("/api/document-builder/configured-")||/^\/api\/document-builder\/documents(?:\/[^/]+\/generate)?$/.test(path))key="document_builder";
 else if(path==="/api/platform/lawyer-requests")key="consultations";
 if(!key)return false;
 const rows=await database().pool.query("SELECT value FROM control_settings WHERE key=$1",[`feature.${key}`]);
 return rows.rows[0]?.value===false;
}
