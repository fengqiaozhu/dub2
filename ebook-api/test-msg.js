const Bree = require('bree');
const path = require('path');
const bree = new Bree({
  root: path.join(__dirname, 'src/jobs'),
  jobs: [],
  workerMessageHandler: (msg) => {
    console.log('Received in workerMessageHandler:', msg);
  }
});
(async () => {
  await bree.start();
  await bree.add({ name: 'test-job', path: path.join(__dirname, 'test-worker.js') });
  bree.start('test-job');
})();
