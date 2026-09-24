import type {CustomRuntimeLegalIdentity} from "./custom-bm25-runtime";

export type PreparedMembership = {ordinal:number;legalIdentitySha256:string|null;legalIdentity?:CustomRuntimeLegalIdentity};
/** null means no prepared generation for this accepted inventory. A published
 * generation with missing or invalid members must fail validation, not fallback. */
export type PreparedMembershipReader = (input:{releaseId:string;sourceInventorySha256:string;
  memberCount:number;itemKeys:readonly string[]})=>Promise<Map<string,PreparedMembership>|null>;
