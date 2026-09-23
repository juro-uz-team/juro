import {createCorpusSession, type CorpusSearchInput, type CorpusSessionInput} from "../lib/legal-chat/corpus-session";

/** The returned RPC capability retains one turn's release pins and read cache.
 * Disposal also prevents subsequent reads after the caller disconnects. */
export class LegalResearchSession {
  #session:ReturnType<typeof createCorpusSession>;

  constructor(input:CorpusSessionInput,createReader:Parameters<typeof createCorpusSession>[1]) {
    this.#session=createCorpusSession(input,createReader);
  }

  search(input:CorpusSearchInput){return this.#session.search(input);}
  async cancel(){this.#session.close();}
  [Symbol.dispose](){this.#session.close();}
}
