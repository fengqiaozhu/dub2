const { Worker } = require('worker_threads');
const w = new Worker(`
  const { parentPort } = require('worker_threads');
  const buf = Buffer.alloc(10 * 1024 * 1024, 'a').toString();
  parentPort.postMessage({ type: 'DONE', payload: buf });
  process.exit(0);
`, { eval: true });
w.on('message', m => console.log('Message received, length:', m.payload.length));
w.on('exit', code => console.log('Exit:', code));
