const { parentPort } = require("worker_threads");
const { solveTopK } = require("./solver");

if (!parentPort) {
  throw new Error("This module must be run as a worker thread");
}

parentPort.on("message", (msg) => {
  (async () => {
    try {
      const { target, options } = msg || {};
      const results = solveTopK(target, options);
      parentPort.postMessage({ ok: true, results });
    } catch (e) {
      parentPort.postMessage({ ok: false, error: e && e.message ? e.message : String(e) });
    }
  })();
});
