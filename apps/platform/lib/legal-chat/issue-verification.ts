import {z} from "zod";
import {legalVerificationSchema, type LegalDraft, type LegalVerification, type legalDraftClaims} from "./answer-contract";

/** The public reading unit is a qualified rule followed by its own actions.
 * Inventory checks establish protocol completeness, never legal correctness. */
export function issueVerificationContract(draft:LegalDraft,claims:ReturnType<typeof legalDraftClaims>,
  evidence:readonly {source:{id:string};passages:readonly {id:string}[]}[]) {
  const findings=draft.ruleBindings.map(binding=>binding.findingId);
  const actions=draft.ruleBindings.flatMap(binding=>binding.actionIds);
  for(const [kind,ids] of [["finding",findings],["action",actions]] as const) {
    const expected=claims.filter(claim=>claim.kind===kind).map(claim=>claim.id);
    if(ids.length!==expected.length || new Set(ids).size!==ids.length || ids.some(id=>!expected.includes(id))) {
      throw new Error("Incomplete issue membership");
    }
  }
  const refs=(ids:string[])=>ids.length?z.array(z.enum(ids)).max(16):z.array(z.string()).max(0);
  const schema=z.object({
    claims:z.object(Object.fromEntries(claims.map(claim=>[claim.id,z.object({
      supported:z.boolean(),
      reason:z.string().min(1).max(1500).nullable().describe("Null for supported claims; precise defect for a rejection."),
      dependsOn:refs(claims.filter(other=>other.id!==claim.id && other.kind===claim.kind
        && ["finding","action","risk"].includes(claim.kind)).map(other=>other.id)),
    }).strict()]))).strict(),
    sources:z.object(Object.fromEntries(evidence.map(source=>[source.source.id,z.array(z.object({
      passageId:z.enum(source.passages.map(passage=>passage.id) as [string,...string[]]),
      missingContent:z.string().min(1).max(1000),
    }).strict()).max(160).describe("Read the complete source, including uncited qualifications. List only material omissions or misstatements; empty when none.")]))).strict(),
    coverage:z.array(legalVerificationSchema.shape.coverage.element.extend({
      findingIds:refs(findings),actionIds:refs(actions),
    })).max(24),
    complete:z.boolean(),gaps:legalVerificationSchema.shape.gaps,questions:legalVerificationSchema.shape.questions,
  }).strict();
  return {schema,materialize(value:z.infer<typeof schema>):LegalVerification {
    for(const verdict of Object.values(value.claims)) {
      if(!verdict.supported && !verdict.reason)throw new Error("Rejected claim needs a defect");
    }
    const {sources,...verification}=value;
    return legalVerificationSchema.parse({...verification,
      claims:Object.entries(value.claims).map(([id,verdict])=>({id,...verdict,
        reason:verdict.reason??"Supported by the independent issue review."})),
      retention:[],sourceGaps:Object.entries(sources).flatMap(([sourceId,omissions])=>omissions.length?[{
        sourceId,passages:[...new Set(omissions.map(item=>item.passageId))].map(id=>({id,
          missingContent:omissions.filter(item=>item.passageId===id).map(item=>item.missingContent)})),
      }]:[]),
    });
  }};
}

export const issueVerificationInstructions=`Independently review the exact proposed public answer against ALL supplied complete official evidence. Writer claims and issue membership are proposals, never proof. Determine material scope from the original question and actual facts, not from what the writer chose to answer.

Publication: each issue displays its finding (the complete Qualified Rule) immediately followed by its explicitly bound actions. Read these together. The finding must preserve every actor, eligibility condition, exception, duration, starting event and consequence needed for its rule. An action may apply that adjacent rule without repeating it, but must not contradict it or introduce a broader permission, duty, remedy or promise. An action's own additional assertions need cited support. Unpaired rules cannot silently qualify another issue's actions. MainPoint and risks remain separate; MainPoint must supply its own decisive qualifications.

For EVERY claim return one verdict under its exact ID. Check the proposition actually asserted against cited evidence, including later qualifying paragraphs and supplied cross-references. Test whether it incorrectly includes a person or event excluded by the rule. Check every member of a list, independent protections, modifier scope, legal numbers, each duration and its own starting event. Advisory wording does not excuse a false premise. Reject a claim containing any unsupported legal assertion even if its other content is correct. A true conditional signpost does not itself assert an unconditional entitlement; do not invent that assertion. MainPoint stating an operative period must state its applicable trigger; another issue cannot repair it. Practical recommendations may reasonably apply the supported rule; mandatory legal steps need official evidence.

Use dependsOn for other claims of the SAME kind supplying essential qualifications; the server withholds claims when their dependencies fail. Each action already depends on its bound finding, so do not add that cross-kind ID. Never borrow qualifications from an unrelated issue, question or missing-evidence statement. Supported reasons may be null; rejection reasons must identify the concrete defect. This shorter output does not reduce the review standard.

Read EVERY source in full, including sources no claim cites. Return its required source key and list material missing or misstated content with the exact passage ID. An empty list declares that review found no material omission in that source, not that citations matched. In particular inspect exceptions, continuing rights, eligibility, alternative conditions, deadlines, triggers and operative references. A citation or topic label does not show that the public text contains a rule. Do not require duplicate wording in a bound action when its adjacent finding already supplies the qualification. If an applicable rule or usable requested step is absent from the entire issue, record the omission. Also reject any existing claim made overbroad by that omission. Supported subset and complete answer are different judgments.

Coverage: independently identify all material issues for the user's decision, including issues the writer omitted. Bind them to actual supported finding and action IDs. actionRequired is false when explanation is sufficient and no material practical step is needed; otherwise require usable guidance read with its bound rule. Report every material deficit on the first review. A narrow value lookup does not require a survey of unrelated categories. A concrete case still requires fact-triggered protections. Do not demand optional future workflows, unrelated legal routes, or hypothetical exceptions absent from the evidence. Unknown facts may be handled with supported alternatives and focused questions; missing governing law must remain unresolved.

Questions and gaps are also claims: reject unsupported premises, irrelevant law gaps and attempts to replace an answerable question with clarification. Prior claims are context for detecting lost material during correction, never an alternative publishable answer. Review only the exact current answer.

complete is true only when the MainPoint gives a supported governing conclusion (when evidence allows one), every material requested issue has supported explanation and useful guidance where needed, and no material omissions, unsupported claims or unresolved law remain. gaps records additional cross-issue or missing-evidence problems, without duplicating source omissions. Neither audit gaps nor questions are automatically published. Internal reasons and gap descriptions use concise English; judge the original-language text without rewriting it.`;
