import type { LegalRequest } from "./contracts";
import type { requestLifetime } from "./lifetime";
import { withinSignal } from "./lifetime";

/** Both transports share cancellation and terminal delivery; callers prepare their own identity and result envelope. */
export function createAnswerEventStream(input: {
  lifetime: ReturnType<typeof requestLifetime>; disconnected: AbortController;
  execute(onBudgetSelected: (duration: number) => void, onProgress: NonNullable<LegalRequest["onProgress"]>,
    onWriting: NonNullable<LegalRequest["onWriting"]>): Promise<Record<string, unknown> | null>;
}) {
  const { signal } = input.lifetime;
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, value: unknown) => {
        signal.throwIfAborted();
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
      };
      let stage = "interpreting", targetMissed = false;
      const writing = new Map<string, string>();
      let revision = 0;
      let sourceSnapshot = "", citationSnapshot = "";
      let notices: string[] = [];
      let targetTimer: ReturnType<typeof setTimeout> | undefined;
      const progress = () => { if (!signal.aborted) send("progress", { stage, targetMissed }); };
      const heartbeat = setInterval(progress, 5000);
      void (async () => {
        try {
          send("progress", { stage: "interpreting" });
          const result = await withinSignal(signal, () => input.execute(duration => {
            clearTimeout(targetTimer);
            targetTimer = setTimeout(() => { targetMissed = true; progress(); }, Math.max(0, input.lifetime.submittedAt + duration - Date.now()));
          }, next => { stage = next; progress(); }, draft => {
            if (draft.sources) {
              const snapshot = JSON.stringify(draft.sources);
              if (snapshot !== sourceSnapshot) { sourceSnapshot = snapshot; send("sources", { sources: draft.sources }); }
            }
            const citations=draft.citations ?? {};
            const citationState=JSON.stringify(citations);
            if(citationState!==citationSnapshot && (draft.citations || citationSnapshot)) {
              citationSnapshot=citationState; send("citations",{citations});
            }
            const nextRevision = draft.revision ?? revision;
            if (!Number.isSafeInteger(nextRevision) || nextRevision < revision || nextRevision > revision + 1)
              throw new Error("WRITING_REVISION_INVALID");
            if (nextRevision > revision) {
              if (!draft.notices || draft.notices.length <= notices.length
                || notices.some((notice, index) => draft.notices![index] !== notice)) throw new Error("WRITING_REVISION_NOTICE_MISSING");
              revision = nextRevision; notices = [...draft.notices]; writing.clear();
              for (const block of draft.blocks) writing.set(block.key, block.text);
              stage = "writing"; send("writing-revision", { revision, notices, blocks: draft.blocks });
              return;
            }
            if ([...writing.keys()].some(key => !draft.blocks.some(block => block.key === key)))
              throw new Error("WRITING_STREAM_REPLACEMENT");
            const blocks = draft.blocks.flatMap(block => {
              const previous = writing.get(block.key) ?? "";
              if (!block.text.startsWith(previous)) throw new Error("WRITING_STREAM_REPLACEMENT");
              writing.set(block.key, block.text);
              return block.text.length > previous.length ? [{ key: block.key, text: block.text.slice(previous.length) }] : [];
            });
            if (blocks.length) { stage = "writing"; send("writing", { blocks, revision }); }
          }));
          if (result) send("result", result);
          else send("error", { code: "LEGAL_ANSWER_NOT_COMPLETED", retryable: true });
          controller.close();
        } catch {
          if (!signal.aborted) {
            send("error", { code: "LEGAL_ANSWER_UNAVAILABLE", retryable: true });
            controller.close();
          } else if (!input.disconnected.signal.aborted) {
            controller.enqueue(encoder.encode('event: error\ndata: {"code":"REQUEST_DEADLINE","retryable":true}\n\n'));
            controller.close();
          } else {
            try { controller.error(new Error("REQUEST_CANCELLED")); } catch { /* Reader already cancelled. */ }
          }
        } finally { clearInterval(heartbeat); clearTimeout(targetTimer); input.lifetime.dispose(); }
      })();
    },
    cancel() { input.disconnected.abort(new Error("DELIVERY_DISCONNECTED")); },
  });
}
