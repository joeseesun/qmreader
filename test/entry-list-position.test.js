const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

test('selected article keeps its viewport offset and keyboard focus after rebuilding the list', () => {
  let focused;
  const list = {
    clientHeight: 300,
    scrollTop: 400,
    getBoundingClientRect: () => ({ top: 100, bottom: 400 }),
    querySelectorAll: () => cards,
  };
  const card = (id, top) => ({
    dataset: { id },
    parentElement: list,
    matches: () => true,
    getBoundingClientRect: () => ({ top: top - list.scrollTop, bottom: top - list.scrollTop + 100 }),
    focus: options => { assert.equal(options.preventScroll, true); focused = id; },
  });
  let cards = [card('first', 500), card('selected', 600), card('third', 700)];
  const sandbox = { document: { activeElement: cards[1] } };
  vm.runInNewContext(source.slice(source.indexOf('function captureEntryListPosition'), source.indexOf('function renderList()')), sandbox);
  const position = sandbox.captureEntryListPosition(list, 'selected');
  cards = [card('first', 600), card('selected', 750), card('third', 850)];
  list.scrollTop = 0;
  sandbox.restoreEntryListPosition(list, position);
  assert.equal(list.scrollTop, 550);
  assert.equal(focused, 'selected');
});

test('unread retains the current article only while it is selected', () => {
  const state = { entries: [{ id: 'read' }, { id: 'unread' }, { id: 'selected' }], view: 'unread', filterSource: 'fixture', read: new Set(['read', 'selected']), activeEntry: { id: 'selected' } };
  const sandbox = { state };
  vm.runInNewContext(source.slice(source.indexOf('function visibleEntries()'), source.indexOf('function sourceById')), sandbox);
  assert.equal(sandbox.visibleEntries().map(e => e.id).join(), 'unread,selected');
  state.activeEntry = null;
  assert.equal(sandbox.visibleEntries().map(e => e.id).join(), 'unread');
});
