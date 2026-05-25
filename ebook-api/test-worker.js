const { parentPort } = require('worker_threads');
parentPort.postMessage({ type: 'DONE', result: 123 });
