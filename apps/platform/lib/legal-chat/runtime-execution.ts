import {researchInterpretation} from "./research-formulation";
import {executeLegalChat} from "./execution";
import {createQuestionInterpreter} from "./question-model";
import {createLegalAnswerModel} from "./answer-model";
import {createLegalResearchModel} from "./research-model";
import {createOfficialResearch} from "./official-research";
import {createRemoteCorpusResearch,type CorpusResearchService} from "./remote-corpus-research";
import {LEGAL_CHAT_EXECUTION_TIMEOUT_MS} from "./execution-limits";
import type {CorpusSessionInput} from "./corpus-session";
import type {AiProviderAttemptObservation} from "../document-builder/ai/openai";
import type {AiResponseTone} from "../ai/runtime-settings";
import {observeCurrentLexDocument} from "../legal/lex-document-status";
import {INDEXED_RETRIEVAL_TIMEOUT_MS} from "../runtime/indexed-retrieval";
import {fitsLegalEvidenceBudget} from "../legal/legal-evidence-budget";

/** Production composition owns all request-local model and research state.
 * Reservation, tenant-scoped storage and replay remain the route's boundary. */
export async function executeRuntimeLegalChat<Saved>(input:
  Omit<Parameters<typeof executeLegalChat<Saved>>[0],"interpret"|"research"|"model"|"observeSource">&{
    service:CorpusResearchService;
    environment:CorpusSessionInput["environment"];
    requestId:string;
    safetyIdentifier?:string;
    responseTone?:AiResponseTone;
    onAttempt?:(input:{model:string})=>void|Promise<void>;
    onAttemptFinished?:(input:AiProviderAttemptObservation)=>void|Promise<void>;
  }):Promise<Saved> {
  // Interpretation, formulation and indexed reading share one deadline.
  // Writing retains the separate execution budget.
  const retrievalExpiresAt=performance.now()+INDEXED_RETRIEVAL_TIMEOUT_MS;
  const interpretationDeadlineAt=Date.now()+INDEXED_RETRIEVAL_TIMEOUT_MS;
  const options={requestId:input.requestId,deadlineAt:Date.now()+LEGAL_CHAT_EXECUTION_TIMEOUT_MS,
    safetyIdentifier:input.safetyIdentifier,onAttempt:input.onAttempt,onAttemptFinished:input.onAttemptFinished};
  const model=createLegalResearchModel({...options,responseTone:input.responseTone});
  const corpus=createRemoteCorpusResearch({service:input.service,environment:input.environment,
    requestId:input.requestId,formulate:model.formulateIndexed,retrievalExpiresAt});
  let stagedQueries=0;
  try {
    return await executeLegalChat({...input,
      interpret:createQuestionInterpreter({...options,mode:input.mode,deadlineAt:interpretationDeadlineAt,
        initialResearch:{discard:corpus.discardInitial,stage:async({context,queries,signal})=>{
          const plan=researchInterpretation(0,queries);
          const request={round:0,needs:[],question:{question:context.question,topics:context.topics,
            locale:input.context.locale,mode:input.mode,answerMode:input.answerMode,temporalScope:context.temporalScope,
            caseFacts:context.caseFacts,userContext:context.userContext,documents:context.documents,priorTurns:context.priorTurns,signal}};
          for(;stagedQueries<plan.formulations.length;stagedQueries++){
            await corpus.stage(request,{interpretationId:plan.id,formulation:plan.formulations[stagedQueries]!});
          }
        }}}),
      research:{indexed:corpus.indexed,official:createOfficialResearch({formulate:model.formulate}),
        // A complete bounded packet needs no separate model selection or
        // answerability verdict. The writer sees
        // every admitted provision; known retrieval gaps remain unresolved.
        assess:request=>fitsLegalEvidenceBudget(request.evidence.map(item=>item.text))
          ? Promise.resolve({needs:[],resolved:[]}) : model.assess(request)},
      model:createLegalAnswerModel({...options,responseTone:input.responseTone}),
      observeSource:observeCurrentLexDocument,
    });
  } finally {await corpus.close();}
}
