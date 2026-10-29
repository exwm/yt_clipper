// Plants each bug in bugs.json, runs its jest tests, records which fail, and restores the file's bytes.
// Every bug should be caught. Bugs with no jest tests are caught only by their UI test: with
// PLANT_UI=1 it runs the UI recipe (`uiCmd`) of the bugs that have one instead.
// Usage: node tools/test/planted-bugs/plant.js [bug id ...]
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const outDir = path.join(root, 'sandbox', 'planted-bugs');
const isUi = Boolean(process.env.PLANT_UI);
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'bugs.json'), 'utf8'));
const only = process.argv.slice(2);
const bugs = catalog.filter(
  (bug) =>
    (only.length === 0 || only.includes(bug.id)) && (isUi ? bug.uiCmd != null : bug.jest.length > 0)
);
fs.mkdirSync(outDir, { recursive: true });

function plantAndRun(bug) {
  const file = path.join(root, bug.file);
  const original = fs.readFileSync(file);
  const text = original.toString('utf8');
  const count = text.split(bug.old).length - 1;
  if (count !== 1) return { error: `old text found ${count} times` };
  const out = path.join(outDir, `${bug.id}${isUi ? '.ui.log' : '.json'}`);
  fs.rmSync(out, { force: true });
  try {
    fs.writeFileSync(
      file,
      text.replace(bug.old, () => bug.new)
    );
    if (isUi) {
      const run = spawnSync(`${bug.uiCmd} > "${out}" 2>&1`, { cwd: root, shell: true });
      return { caught: run.status !== 0, exit: run.status };
    }
    const args = ['jest', ...bug.jest, '--json', '--outputFile', out, '--silent'];
    spawnSync('npx', args, { cwd: root, shell: true, stdio: 'ignore' });
  } finally {
    fs.writeFileSync(file, original);
  }
  if (!fs.existsSync(out)) return { error: 'jest wrote no report' };
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  const failed = report.testResults.flatMap((suite) =>
    suite.assertionResults
      .filter((a) => a.status === 'failed')
      .map((a) => `${path.basename(suite.name)} :: ${a.fullName}`)
  );
  // A suite that fails to run (a type error from the patch) also counts as caught.
  const suiteErrors = report.testResults
    .filter((suite) => suite.status === 'failed' && suite.assertionResults.length === 0)
    .map((suite) => suite.message.slice(0, 200));
  return { caught: failed.length > 0 || suiteErrors.length > 0, failed, suiteErrors };
}

const started = Date.now();
const results = [];
for (const bug of bugs) {
  const t0 = Date.now();
  const result = { id: bug.id, ...plantAndRun(bug), seconds: (Date.now() - t0) / 1000 };
  results.push(result);
  const outcome = result.error ?? (result.caught ? 'caught' : 'MISSED');
  const detail = isUi ? `exit ${result.exit}` : `${result.failed?.length ?? 0} failing`;
  console.log(`${bug.id}\t${outcome}\t${detail}\t${result.seconds.toFixed(1)} s`);
}
console.log(`total ${((Date.now() - started) / 1000).toFixed(1)} s`);
fs.writeFileSync(
  path.join(outDir, isUi ? 'results-ui.json' : 'results.json'),
  JSON.stringify(results, null, 1)
);
const missed = results.filter((r) => !r.caught);
if (missed.length > 0) {
  console.log(`not caught: ${missed.map((r) => r.id).join(', ')}`);
  process.exit(1);
}
