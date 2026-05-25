const Bree = require('bree');
const path = require('path');
const bree = new Bree({
  root: path.join(__dirname, 'src/jobs'),
  jobs: []
});
(async () => {
  await bree.start();
  console.log('add job');
  const res = bree.add({ name: 'test-job', path: path.join(__dirname, 'src/jobs/index.js') });
  console.log('bree.add returned:', res);
  console.log('start job');
  await bree.start('test-job');
})();
