import {createHash} from "node:crypto";
import {z} from "zod";
import {preparedCandidateConfigurationSchema,type PreparedCandidateConfiguration} from "./prepared-candidate-configuration";
import {classifyLegalSourceUrl} from "../legal/source-fetch";

const hash=z.string().regex(/^[a-f0-9]{64}$/u);
const ordinal=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const object=z.record(z.string(),z.unknown());
const packetSchema=z.object({
  package_sha256:hash,membership_sha256:hash,work_index_sha256:hash,vector_completion_sha256:hash,
  records:z.array(z.object({vector_ordinal:ordinal,membership_ordinal:ordinal,compact_input_hash:hash,
    original_input_hash:hash,work:z.string().min(1),unit:z.string().min(1),status:z.literal("discovery_only"),
    chunk:z.object({id:z.string().regex(/^retrieval-chunk-v1:[a-f0-9]{64}$/u),work:z.string(),
      officialText:z.string().min(1),officialTextSha256:hash,language:z.string(),script:z.string()}).passthrough(),
  }).strict()).max(128),
  sources:z.record(z.string(),z.object({inventory:object,prepared:object}).strict()),
  units:z.record(z.string(),object),continuations:z.record(z.string(),z.unknown()),
}).strict();

/** Authenticated discovery transport boundary. Publisher metadata is retained
 * verbatim; it cannot establish currentness, applicability or textual authority. */
export function createPreparedDiscoveryCatalog(transport:{readExact(input:{
  artifacts:PreparedCandidateConfiguration["artifacts"];references:Array<[number,number]>;
}):Promise<unknown>}){
  return {async read(configuration:PreparedCandidateConfiguration,references:Array<[number,number]>){
    const config=preparedCandidateConfigurationSchema.parse(configuration);
    const requested=z.array(z.tuple([ordinal,ordinal])).max(128).parse(references);
    if(new Set(requested.map(row=>row.join(":"))).size!==requested.length)throw Error("PREPARED_CATALOG_DUPLICATE_REFERENCE");
    const packet=packetSchema.parse(await transport.readExact({artifacts:config.artifacts,references:requested}));
    const pins=config.artifacts;
    if(packet.package_sha256!==pins.packageSha256||packet.membership_sha256!==pins.membershipSha256
      ||packet.work_index_sha256!==pins.workIndexSha256||packet.vector_completion_sha256!==pins.vectorCompletionSha256
      ||Object.keys(packet.continuations).length||packet.records.length!==requested.length){
      throw Error("PREPARED_CATALOG_GENERATION_MISMATCH");
    }
    for(const [position,row] of packet.records.entries()){
      const reference=requested[position]!;const source=packet.sources[row.work];const unit=packet.units[row.unit];
      if(row.vector_ordinal!==reference[0]||row.membership_ordinal!==reference[1]||row.chunk.work!==row.work
        ||!source||source.inventory.id!==row.work||source.prepared.work!==row.work||!unit
        ||row.chunk.snapshotProvisionId!==row.unit||row.unit!==`${row.work}:${unit.ordinal}`
        ||typeof unit.text!=="string"||!unit.text.includes(row.chunk.officialText)
        ||createHash("sha256").update(row.chunk.officialText).digest("hex")!==row.chunk.officialTextSha256){
        throw Error("PREPARED_CATALOG_MEMBERSHIP_MISMATCH");
      }
      if(typeof source.inventory.url!=="string"||classifyLegalSourceUrl(source.inventory.url).sourceKind!=="lex"){
        throw Error("PREPARED_CATALOG_OFFICIAL_SOURCE_REQUIRED");
      }
    }
    return packet;
  }};
}
