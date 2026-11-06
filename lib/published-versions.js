// Only the registered publisher can supply an already published rewrite.
function publishedVersions(value, source, link) {
  if (source?.id !== 'xnews') return null;
  if (new URL(link).origin !== 'https://xnews.qiaomu.ai') throw Error('Invalid X News article origin');
  const v = typeof value === 'string' ? JSON.parse(value) : value;
  const text = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.length <= max;
  if (v?.version !== 1 || !text(v.original?.title, 2000) || !text(v.original?.html, 2000000)
    || !text(v.original?.lang, 30) || !text(v.original?.url, 4000)
    || !text(v.rewrite?.title, 2000) || !text(v.rewrite?.markdown, 2000000) || !text(v.rewrite?.html, 2000000)
    || !/^https?:$/.test(new URL(v.original.url).protocol)) throw Error('X News versioned content is missing or invalid');
  return { version: 1, original: { ...v.original }, rewrite: { ...v.rewrite } };
}
module.exports = { publishedVersions };
