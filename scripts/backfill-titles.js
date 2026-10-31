#!/usr/bin/env node
'use strict';
// Missing titles only; does not fetch RSS, translate bodies or enqueue rewrites.
const fetcher = require('../lib/fetcher');
const store = require('../lib/store');
const deepseek = require('../lib/deepseek');
async function main() {
  const raw = process.argv.find(arg => arg.startsWith('--limit='))?.slice(8) || '1000';
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw Error('Use --limit=1..10000');
  fetcher.loadDisk({ upsert: false });
  const entries = store.getTitleTranslationCandidates({
    sourceIds: fetcher.getSourcesMeta().filter(source => source.enabled).map(source => source.id),
    limit, needsTranslation: deepseek.needsEntryTitleTranslation,
  });
  const sources = {};
  for (const entry of entries) sources[entry.sourceId] = (sources[entry.sourceId] || 0) + 1;
  console.log(JSON.stringify({ type: 'plan', count: entries.length, limit, sources, execute: process.argv.includes('--execute') }));
  if (!process.argv.includes('--execute')) return;
  let translated = 0;
  for (let i = 0; i < entries.length; i += 20) {
    // A concurrent worker may already have completed some of this batch.
    const pending = entries.slice(i, i + 20).filter(entry => {
      const latest = store.getEntry(entry.id);
      return latest && !latest.titleZh && latest.title === entry.title;
    });
    if (!pending.length) continue;
    const result = await deepseek.translateTitleBatch(pending, { author: 'system', model: 'deepseek-flash' });
    translated += result.translations.length;
    console.log(JSON.stringify({ type: 'batch', processed: i + pending.length, translated, missing: result.missingEntryIds || [] }));
  }
  const remaining = entries.filter(entry => { const latest = store.getEntry(entry.id); return latest && !latest.titleZh; });
  console.log(JSON.stringify({ type: 'complete', translated, remaining: remaining.length, bounded: entries.length === limit }));
  if (remaining.length) process.exitCode = 2;
}
if (require.main === module) main().catch(error => { console.error(error.code || '', error.message); process.exitCode = 1; });
