#!/usr/bin/env node
if (!process.env.QMREADER_WORKER_KIND) {
  process.env.QMREADER_WORKER_KIND = process.send ? 'ipc' : 'cli';
}
const { runRefreshJob } = require('../lib/background-jobs');

function send(message) {
  if (process.send) process.send(message);
}

function parseArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

async function run(job = {}) {
  try {
    send({ type: 'started', job, startedAt: Date.now() });
    const result = await runRefreshJob(job, {
      onProgress(done, total, sourceId) {
        send({ type: 'progress', done, total, sourceId });
      },
      onFetchDone(refresh) {
        send({ type: 'fetchDone', refresh, finishedAt: Date.now() });
      },
      onAutoRewriteStart(sourceIds) {
        send({ type: 'autoRewriteStart', sourceIds, startedAt: Date.now() });
      },
      onAutoRewriteDone(autoRewrite) {
        send({ type: 'autoRewriteDone', autoRewrite, finishedAt: Date.now() });
      },
    });
    send({ type: 'done', result });
    return result;
  } catch (error) {
    const payload = {
      message: String(error.message || error),
      statusCode: error.statusCode || 500,
      stack: error.stack || '',
    };
    send({ type: 'error', error: payload });
    console.error(payload.stack || payload.message);
    process.exitCode = 1;
    return null;
  }
}

if (process.send) {
  process.on('message', message => {
    if (!message || message.type !== 'run') return;
    run(message.job).finally(() => {
      setTimeout(() => process.exit(process.exitCode || 0), 20);
    });
  });
} else {
  const kind = parseArg('kind') || 'refresh';
  const sourceId = parseArg('source');
  const sourceIds = parseArg('sources')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
  run({ kind, sourceId, sourceIds }).then(result => {
    if (result) console.log(JSON.stringify(result, null, 2));
  }).finally(() => {
    setTimeout(() => process.exit(process.exitCode || 0), 20);
  });
}
