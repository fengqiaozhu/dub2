/**
 * QA harness (not a *.test.js, so it is NOT picked up by `npm test`).
 *
 * Independent runtime proof for the H1 fix (CMP-33, commit 52a43bd) at the
 * DATABASE level, which is the half of the defect that cannot be argued away by
 * inspecting the worker side: a cancelled job must never be resurrected by a
 * late worker write, even after the in-memory cancel marker has been released.
 *
 * Uses the real PostgreSQL schema and the real JobRepository. No TTS/LLM, no
 * object storage, no timers longer than a few seconds.
 *
 * Run:
 *   DATABASE_URL=postgres://ebook:ebook@127.0.0.1:5432/ebook node test/qa-h1-db-guard.js
 */
const path = require('path');
const assert = require('assert');
const { randomUUID } = require('crypto');

const API_ROOT = path.resolve(__dirname, '..');
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} :: ${name} :: ${detail}`);
}

async function main() {
  const db = require(path.join(API_ROOT, 'src/repositories/postgres/db'));
  const { jobRepository } = require(path.join(API_ROOT, 'src/repositories'));

  const id = randomUUID();

  // 1. A live job reaches RUNNING through the same guarded path the worker uses.
  await jobRepository.create({
    id,
    job_name: `qa-h1-guard-${id.slice(0, 8)}`,
    type: 'qaH1Guard',
    target_id: 'qa',
    status: 'PENDING',
    progress: 0
  });
  const running = await jobRepository.updateUnlessCancelled(id, { status: 'RUNNING', progress: 50 });
  record(
    'h1/guard/progress-write-works',
    running.status === 'RUNNING' && running.progress === 50,
    `updateUnlessCancelled(progress) on a live job -> status=${running.status} progress=${running.progress}`
  );

  // 2. Cancellation persists CANCELLED.
  const cancelled = await jobRepository.updateUnlessCancelled(id, { status: 'CANCELLED' });
  record(
    'h1/guard/cancel-persists',
    cancelled.status === 'CANCELLED',
    `updateUnlessCancelled(CANCELLED) -> status=${cancelled.status}`
  );

  // 3. THE decisive part: the in-memory cancel marker is released when cancelJob
  //    returns, so any worker message arriving afterwards is stopped only by the
  //    SQL guard. Simulate those late writes one by one.
  const lateWrites = [
    { label: 'late DONE', patch: { status: 'DONE', result: { ok: true } } },
    { label: 'late ERROR', patch: { status: 'FAILED', error: 'boom after cancel' } },
    { label: 'late PROGRESS', patch: { status: 'RUNNING', progress: 90 } }
  ];
  const survivors = [];
  for (const late of lateWrites) {
    const after = await jobRepository.updateUnlessCancelled(id, late.patch);
    if (after.status !== 'CANCELLED') survivors.push(`${late.label} -> ${after.status}`);
  }
  record(
    'h1/guard/late-writes-cannot-resurrect',
    survivors.length === 0,
    survivors.length === 0
      ? `${lateWrites.map((l) => l.label).join(', ')} all left status=CANCELLED (guard: "AND status <> 'CANCELLED'")`
      : `RESURRECTED: ${survivors.join('; ')}`
  );

  // 4. Control: prove the guard is load-bearing rather than incidental. The plain
  //    update() used elsewhere has no guard, so it WOULD overwrite the row. If this
  //    ever stops overwriting, the protection in (3) is not coming from the SQL.
  const control = await jobRepository.update(id, { status: 'RUNNING', progress: 99 });
  const controlAfter = await jobRepository.findById(id);
  const guardIsLoadBearing = controlAfter.status === 'RUNNING';
  record(
    'h1/guard/control-plain-update-overwrites',
    guardIsLoadBearing,
    `plain update() on a CANCELLED row -> status=${controlAfter.status} ` +
    `(expected RUNNING). This confirms the protection in the previous check comes from the ` +
    `guarded path jobManager actually routes PROGRESS/DONE/ERROR through, not from luck.` +
    (control ? '' : ' (update() returned nothing)')
  );

  // Restore so the control assertion cannot leave a stray RUNNING row behind.
  await jobRepository.update(id, { status: 'CANCELLED' });

  // 5. Idempotence: cancelling an already-CANCELLED job keeps it terminal.
  const again = await jobRepository.updateUnlessCancelled(id, { status: 'CANCELLED' });
  record(
    'h1/guard/cancel-is-idempotent',
    again.status === 'CANCELLED',
    `second cancellation on the same row -> status=${again.status}`
  );

  // JobRepository has no delete(); drop the probe row directly so the DB stays clean.
  await db.query('DELETE FROM jobs WHERE id = $1', [id]).catch(() => {});
  await db.close().catch(() => {});

  const failed = results.filter((r) => !r.ok);
  console.log('\n==== SUMMARY ====');
  console.log(`total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  console.log(`exit_code=${failed.length ? 1 : 0}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error('HARNESS_ERROR', error && error.message);
  process.exit(2);
});
