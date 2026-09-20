import {RpcTarget} from "cloudflare:workers";
import {createCorpusSession, type CorpusSearchInput, type CorpusSessionInput} from "../lib/legal-chat/corpus-session";

/** The returned RPC capability retains one turn's release pins and read cache.
 * Disposal also prevents subsequent reads after the caller disconnects. */
export class LegalResearchSession extends RpcTarget {
  #session:ReturnType<typeof createCorpusSession>;

  constructor(input:CorpusSessionInput,createReader:Parameters<typeof createCorpusSession>[1]) {
    super();
    this.#session=createCorpusSession(input,createReader);
  }

  search(input:CorpusSearchInput){return this.#session.search(input);}
  cancel(){this.#session.close();}
  [Symbol.dispose](){this.#session.close();}
}
