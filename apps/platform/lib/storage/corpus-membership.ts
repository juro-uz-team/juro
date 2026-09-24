import {z} from "zod";
import type {Pool} from "pg";
import {customRuntimeLegalIdentitySchema} from "../legal-corpus/custom-bm25-runtime";
import type {PreparedMembershipReader} from "../legal-corpus/prepared-membership";
import {retrievalQuery} from "./retrieval-connection";

const digest=z.string().regex(/^[a-f0-9]{64}$/u);
const memberSchema=z.object({itemKey:z.string().min(1).max(700),ordinal:z.number().int().nonnegative().safe(),
  legalIdentitySha256:digest.optional(),legalIdentity:customRuntimeLegalIdentitySchema.optional()}).strict()
  .refine(member=>!member.legalIdentitySha256||!member.legalIdentity
    ||member.legalIdentitySha256===member.legalIdentity.legalIdentitySha256,"Membership identity hashes must agree");

/** The accepted inventory hash comes from the pinned release ledger, never a
 * search hit. PostgreSQL publication authenticates every source page and member
 * before this immutable point lookup can replace the object-directory layout. */
export function createPreparedMembershipReader(pool:Pool):PreparedMembershipReader {
  return async input=>{
    const hash=digest.parse(input.sourceInventorySha256);
    const count=z.number().int().positive().max(2**24).parse(input.memberCount);
    const keys=[...new Set(input.itemKeys)];
    if(keys.length>2000)throw new Error("CORPUS_MEMBERSHIP_REQUEST_TOO_LARGE");
    const {rows}=await retrievalQuery<{member:unknown}>(pool,`WITH generation AS MATERIALIZED (
      SELECT id FROM storage.corpus_membership_generations
      WHERE release_id=$1 AND source_inventory_sha256=$2 AND member_count=$3 AND state='verified'
      ORDER BY created_at DESC,id LIMIT 1
    ) SELECT member.member FROM generation
      LEFT JOIN storage.corpus_members member ON member.generation_id=generation.id AND member.item_key=ANY($4::text[])`,
    [input.releaseId,hash,count,keys]);
    if(!rows.length)return null;
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
