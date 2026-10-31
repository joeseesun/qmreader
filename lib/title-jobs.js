'use strict';
// One bounded queue shared by all refresh clients. Translation is asynchronous;
// completed titles live in the existing hashed translation cache.
function createTitleJobs({ read, eligible, translate, clock = Date.now, schedule = setTimeout }) {
  const queue = new Map(), attempted = new Map();
  let running = false;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queue.size) {
        const batch = [...queue.values()].slice(0, 20);
        batch.forEach(entry => queue.delete(entry.id));
        try { await translate(batch); }
        catch (error) { console.warn('Refresh title translation:', error.code || 'failed'); }
      }
    } finally { running = false; }
  }
  return function request(ids, enqueue = false) {
    const entries = read([...new Set(ids)].slice(0, 40)).filter(eligible);
    const titles = entries.map(entry => ({ id: entry.id, title: entry.title, titleZh: entry.titleZh || null }));
    if (enqueue) {
      for (const entry of entries) {
        const key = entry.id + ':' + entry.title;
        if (entry.titleZh || queue.size >= 200 || clock() - (attempted.get(key) || 0) < 10 * 60 * 1000) continue;
        attempted.set(key, clock()); queue.set(entry.id, entry);
      }
      while (attempted.size > 5000) attempted.delete(attempted.keys().next().value);
      if (queue.size && !running) schedule(() => { void drain(); }, 0);
    }
    return { titles, pending: entries.some(entry => !entry.titleZh && (queue.has(entry.id) || running)) };
  };
}
module.exports = { createTitleJobs };
