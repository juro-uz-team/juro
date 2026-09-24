const {parentPort} = require('node:worker_threads');
parentPort.on('message', async input => {
  if (input.crash) process.exit(3);
  if (input.spin) {if(input.started) Atomics.store(new Int32Array(input.started),0,1); for (;;) { /* Cancellation must terminate CPU work. */ }}
  const counters = input.counters ? new Int32Array(input.counters) : undefined;
  if (counters) {
    const active = Atomics.add(counters, 0, 1) + 1;
    let peak = Atomics.load(counters, 1);
    while (active > peak) {
      const previous = Atomics.compareExchange(counters, 1, peak, active);
      if (previous === peak) break;
      peak = previous;
    }
  }
  await new Promise(resolve => setTimeout(resolve, input.delay ?? 0));
  if (counters) Atomics.sub(counters, 0, 1);
  parentPort.postMessage({ok:true,value:input.value});
});
