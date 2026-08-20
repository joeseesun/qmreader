const test = require('node:test');
const assert = require('node:assert/strict');

const { SOURCES } = require('../lib/sources');

test('Hacker News is not registered as a source', () => {
  assert.equal(SOURCES.some(source => source.id === 'hackernews'), false);
});
