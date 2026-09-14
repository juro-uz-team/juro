export function legalRetrievalEnvironment(bindings: {
  APP_ENV?: "development" | "staging" | "production";
  LEGAL_RETRIEVAL_ENVIRONMENT?: "development" | "staging" | "production";
}): "development" | "staging" | "production" {
  return bindings.LEGAL_RETRIEVAL_ENVIRONMENT ?? bindings.APP_ENV ?? "development";
}
