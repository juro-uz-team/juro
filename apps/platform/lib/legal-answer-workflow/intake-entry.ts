import { runtimeEnv } from "../document-builder/storage/runtime";
import { questionIntakeKeyring } from "../ai/question-intake";
import { authenticateSignedAnswer } from "./platform-auth";
import { handleQuestionIntakeHttp } from "./intake-http";

export function questionIntakeRoute(operation: "create" | "consume" | "finalize") {
  return (request: Request) => handleQuestionIntakeHttp(request, operation, {
    authenticate: authenticateSignedAnswer,
    keyring: () => questionIntakeKeyring(runtimeEnv().IDENTITY_KEYRING),
  });
}
