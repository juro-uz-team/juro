import {Worker} from "node:worker_threads";

type Task = {
  input: unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void;
  signal?: AbortSignal; abort: () => void; slot?: Slot;
};
type Slot = {worker: Worker; task?: Task; stopping?: Promise<number>};

/** CPU work cannot block request deadlines. Cancellation terminates its worker,
 * and a replacement is admitted only after that thread has actually stopped. */
export class WorkerTaskPool<Input, Output> {
  private readonly slots = new Set<Slot>();
  private readonly queue: Task[] = [];
  private closed = false;

  constructor(private readonly filename: string, private readonly capacity: number,
    private readonly maximumQueued = 64) {
    if (!Number.isInteger(capacity) || capacity < 1 || !Number.isInteger(maximumQueued) || maximumQueued < 1) {
      throw new TypeError("WORKER_POOL_CAPACITY_INVALID");
    }
  }

  run(input: Input, signal?: AbortSignal): Promise<Output> {
    if (this.closed) return Promise.reject(new Error("WORKER_POOL_CLOSED"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.queue.length >= this.maximumQueued) return Promise.reject(new Error("WORKER_QUEUE_FULL"));
    return new Promise<Output>((resolve, reject) => {
      const task: Task = {input, resolve: value => resolve(value as Output), reject, signal, abort: () => {
        if (task.slot) this.retire(task.slot, signal!.reason);
        else {
          const index = this.queue.indexOf(task);
          if (index >= 0) this.queue.splice(index, 1);
          this.finish(task, signal!.reason);
        }
      }};
      signal?.addEventListener("abort", task.abort, {once:true});
      this.queue.push(task);
      this.pump();
    });
  }

  private finish(task: Task, error?: unknown, value?: unknown) {
    task.signal?.removeEventListener("abort", task.abort);
    if (error !== undefined) task.reject(error); else task.resolve(value);
  }

  private retire(slot: Slot, error: unknown): Promise<number> {
    if (slot.stopping) return slot.stopping;
    if (slot.task) {this.finish(slot.task, error); slot.task = undefined;}
    slot.stopping = slot.worker.terminate().finally(() => {
      this.slots.delete(slot);
      this.pump();
    });
    return slot.stopping;
  }

  private pump() {
    if (this.closed) return;
    while (this.queue.length) {
      let slot = [...this.slots].find(candidate => !candidate.task && !candidate.stopping);
      if (!slot) {
        if (this.slots.size >= this.capacity) return;
        try {
          slot = {worker:new Worker(this.filename, {execArgv:[], resourceLimits:{maxOldGenerationSizeMb:512}})};
        } catch (error) {this.finish(this.queue.shift()!, error); continue;}
        const created = slot;
        this.slots.add(created);
        created.worker.on("error", error => {void this.retire(created, error);});
        created.worker.on("exit", code => {
          if (!created.stopping) void this.retire(created, new Error(`WORKER_EXITED:${code}`));
        });
        created.worker.on("message", (message: {ok?: boolean; value?: unknown; error?: string}) => {
          if (created.stopping || !created.task) return;
          const task = created.task; created.task = undefined;
          if (message?.ok === true) this.finish(task, undefined, message.value);
          else this.finish(task, new Error(message?.error ?? "WORKER_RESPONSE_INVALID"));
          created.worker.unref();
          this.pump();
        });
      }
      const task = this.queue.shift()!;
      slot.task = task; task.slot = slot;
      slot.worker.ref();
      try {slot.worker.postMessage(task.input);}
      catch (error) {void this.retire(slot, error);}
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const error = new Error("WORKER_POOL_CLOSED");
    for (const task of this.queue.splice(0)) this.finish(task, error);
    await Promise.all([...this.slots].map(slot => this.retire(slot, error)));
  }
}
