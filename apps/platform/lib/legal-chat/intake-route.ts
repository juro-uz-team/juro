import {z} from "zod";
import {assertSafeWrite,requireApiUser,withApiErrors} from "../document-builder/auth/api";
import {requireD1,runtimeEnv} from "../document-builder/storage/runtime";
import {parseJsonRequest} from "../auth/input";
import {workspaceForUserById} from "../platform/workspace";
import {issueQuestionIntake,openQuestionIntake,finalizeQuestionIntake,questionIntakeKeyring,
  questionIntakeCreateSchema,questionIntakeConsumeSchema,QuestionIntakeError} from "../ai/question-intake";

const response=(body:unknown,status=200)=>Response.json(body,{status,
  headers:{"cache-control":"private, no-store","referrer-policy":"no-referrer",pragma:"no-cache"}});
type IntakeBody=z.infer<typeof questionIntakeCreateSchema>|z.infer<typeof questionIntakeConsumeSchema>;

/** All draft operations authenticate the body-selected workspace before accessing ciphertext. */
export function questionIntakeRoute(operation:"create"|"consume"|"finalize") {
  const handle=withApiErrors(async(request:Request)=>{
    assertSafeWrite(request);
    const user=await requireApiUser(request);
    const parsed=await parseJsonRequest<IntakeBody>(request,
      operation==="create"?questionIntakeCreateSchema:questionIntakeConsumeSchema,20_480);
    if(!parsed.ok)return response({error:"AI_QUESTION_INTAKE_INVALID"},parsed.error==="payload_too_large"?413:400);
    const workspace=await workspaceForUserById(user.id,parsed.data.workspaceId);
    if(!workspace)return response({error:"AI_QUESTION_INTAKE_UNAVAILABLE"},404);
    const owner={db:requireD1(),workspaceId:workspace.id,userId:user.id};
    try {
      if(operation==="create"&&"question" in parsed.data) {
        return response(await issueQuestionIntake({...owner,question:parsed.data.question,
          keyring:questionIntakeKeyring(runtimeEnv().IDENTITY_KEYRING)}));
      }
      if(!("handle" in parsed.data))return response({error:"AI_QUESTION_INTAKE_INVALID"},400);
      if(operation==="finalize") {
        await finalizeQuestionIntake({...owner,handle:parsed.data.handle});
        return response({ok:true});
      }
      return response({question:await openQuestionIntake({...owner,handle:parsed.data.handle,
        keyring:questionIntakeKeyring(runtimeEnv().IDENTITY_KEYRING)})});
    } catch(error) {
      if(!(error instanceof QuestionIntakeError))throw error;
      const status=error.code==="AI_QUESTION_INTAKE_UNAVAILABLE"?404
        :error.code==="AI_QUESTION_INTAKE_CAPACITY_EXCEEDED"?429
        :error.code==="AI_QUESTION_INTAKE_INVALID"?400:503;
      return response({error:error.code},status);
    }
  });
  return async(request:Request)=>{
    const result=await handle(request);
    result.headers.set("referrer-policy","no-referrer");
    return result;
  };
}
