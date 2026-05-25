const { Worker } = require('worker_threads');
const w = new Worker(`
  const { parentPort } = require('worker_threads');
  parentPort.postMessage('hello');
  process.exit(0);
`, { eval: true });
w.on('message', m => console.log('Message:', m));
w.on('exit', code => console.log('Exit:', code));
