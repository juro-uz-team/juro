/** Context limits fail explicitly instead of silently dropping prior facts. */
export class LegalContextCapacityError extends Error {
  readonly code="LEGAL_CONTEXT_CAPACITY_EXCEEDED";
  constructor(){super("LEGAL_CONTEXT_CAPACITY_EXCEEDED");this.name="LegalContextCapacityError";}
}
