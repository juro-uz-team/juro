import {z} from "zod";
import type {Pool} from "pg";
import {customRuntimeLegalIdentitySchema} from "../legal-corpus/custom-bm25-runtime";
import type {PreparedMembershipReader,PreparedOrdinalReader} from "../legal-corpus/prepared-membership";
import {retrievalQuery} from "./retrieval-connection";

export type PreparedMembershipPins=ReadonlyMap<string,{generation:string;sha256:string;count:number}>;
function pinnedGeneration(pins:PreparedMembershipPins|undefined,input:{releaseId:string;sourceInventorySha256:string;memberCount:number}) {
  if(!pins)return null;
  const pin=pins.get(input.releaseId);
  if(!pin||pin.sha256!==input.sourceInventorySha256||pin.count!==input.memberCount)throw Error("CORPUS_MEMBERSHIP_PIN_MISMATCH");
  return z.uuid().parse(pin.generation);
}
const digest=z.string().regex(/^[a-f0-9]{64}$/u);

/** Resolve sparse ordinals from the same authenticated, immutable inventory as
 * candidate validation. A missing ordinal in a verified generation is an error. */
export function createPreparedOrdinalReader(pool:Pool,pins?:PreparedMembershipPins):PreparedOrdinalReader {
  return async input=>{
    const generation=pinnedGeneration(pins,input);
    const hash=digest.parse(input.sourceInventorySha256);
    const count=z.number().int().positive().max(2**24).parse(input.memberCount);
    const ordinals=z.array(z.number().int().nonnegative().safe()).max(2000).parse(input.ordinals);
    if(!ordinals.length)return [];
    const {rows}=await retrievalQuery<{ordinal:string|null;item_key:string|null}>(pool,`WITH generation AS MATERIALIZED (
      SELECT id FROM storage.corpus_membership_generations
      WHERE release_id=$1 AND source_inventory_sha256=$2 AND member_count=$3 AND state='verified' AND ($5::uuid IS NULL OR id=$5::uuid)
      ORDER BY created_at DESC,id LIMIT 1
    ) SELECT member.ordinal,member.item_key FROM generation
      LEFT JOIN storage.corpus_members member ON member.generation_id=generation.id AND member.ordinal=ANY($4::bigint[])`,
    [input.releaseId,hash,count,[...new Set(ordinals)],generation]);
    if(!rows.length){if(pins)throw Error("CORPUS_MEMBERSHIP_GENERATION_UNAVAILABLE");return null;}
    const found=new Map<number,string>();
    for(const row of rows){
      if(row.ordinal===null&&row.item_key===null)continue;
      const ordinal=Number(row.ordinal),key=z.string().min(1).max(700).parse(row.item_key);
      if(!ordinals.includes(ordinal)||found.has(ordinal))throw new Error("CORPUS_ORDINAL_RESULT_INVALID");
      found.set(ordinal,key);
    }
    if(ordinals.some(ordinal=>!found.has(ordinal)))throw new Error("CORPUS_ORDINAL_MISSING");
    return ordinals.map(ordinal=>found.get(ordinal)!);
  };
}
const memberSchema=z.object({itemKey:z.string().min(1).max(700),ordinal:z.number().int().nonnegative().safe(),
  legalIdentitySha256:digest.optional(),legalIdentity:customRuntimeLegalIdentitySchema.optional()}).strict()
  .refine(member=>!member.legalIdentitySha256||!member.legalIdentity
    ||member.legalIdentitySha256===member.legalIdentity.legalIdentitySha256,"Membership identity hashes must agree");

/** The accepted inventory hash comes from the pinned release ledger, never a
 * search hit. PostgreSQL publication authenticates every source page and member
 * before this immutable point lookup can replace the object-directory layout. */
export function createPreparedMembershipReader(pool:Pool,pins?:PreparedMembershipPins):PreparedMembershipReader {
  return async input=>{
    const generation=pinnedGeneration(pins,input);
    const hash=digest.parse(input.sourceInventorySha256);
    const count=z.number().int().positive().max(2**24).parse(input.memberCount);
    const keys=[...new Set(input.itemKeys)];
    if(keys.length>2000)throw new Error("CORPUS_MEMBERSHIP_REQUEST_TOO_LARGE");
    const {rows}=await retrievalQuery<{member:unknown}>(pool,`WITH generation AS MATERIALIZED (
      SELECT id FROM storage.corpus_membership_generations
      WHERE release_id=$1 AND source_inventory_sha256=$2 AND member_count=$3 AND state='verified' AND ($5::uuid IS NULL OR id=$5::uuid)
      ORDER BY created_at DESC,id LIMIT 1
    ) SELECT member.member FROM generation
      LEFT JOIN storage.corpus_members member ON member.generation_id=generation.id AND member.item_key=ANY($4::text[])`,
    [input.releaseId,hash,count,keys,generation]);
    if(!rows.length){if(pins)throw Error("CORPUS_MEMBERSHIP_GENERATION_UNAVAILABLE");return null;}
    const result=new Map();
    for(const row of rows){
      if(row.member===null)continue;
      const member=memberSchema.parse(row.member);
      if(!keys.includes(member.itemKey)||result.has(member.itemKey))throw new Error("CORPUS_MEMBERSHIP_RESULT_INVALID");
      result.set(member.itemKey,{ordinal:member.ordinal,
        legalIdentitySha256:member.legalIdentitySha256??member.legalIdentity?.legalIdentitySha256??null,
        ...(member.legalIdentity?{legalIdentity:member.legalIdentity}:{})});
    }
    return result;
  };
}
