const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
function fn(name, next) { const start = source.indexOf(`function ${name}(`); return source.slice(source.lastIndexOf('async ', start) === start - 6 ? start - 6 : start, source.indexOf(next, start)); }
function harness(api) {
  const nodes = new Map();
  const state = { me: null, authReady: false, authRevision: 0 };
  const ctx = vm.createContext({ state, api, Boolean, Number, String,
    $: selector => { if (!nodes.has(selector)) nodes.set(selector, { classList: { toggle() {}, add() {} } }); return nodes.get(selector); },
    normalizeDefaultReaderTab: x => x || 'rewrite',
    setAccountMenuOpen() {}, closeChangePasswordModal() {}, avatarHtml: () => '', escapeHtml: String,
    isAdmin: () => false, renderAdminEntryControls() {}, renderSidebarAiSettings() {}, updateAgentControls() {},
    loadUserEntryStates: async () => {}, loadAiProfilesForScope() {}, renderEntryStateUi() {}, renderComments() {}, renderAgent() {}, renderAiSettings() {}, updateMarkReadButton() {},
  });
  vm.runInContext(fn('setCurrentUser', '\nfunction activeSourceForEntry') + fn('renderAuthState', '\nfunction setAccountMenuOpen') + fn('loadMe', '\n/* ---------- Sidebar'), ctx);
  return { ctx, nodes, state };
}
test('login remains available while a slow session request is pending', () => {
  const h = harness(() => new Promise(() => {}));
  h.ctx.renderAuthState();
  assert.equal(h.nodes.get('#auth-open').disabled, false);
  assert.match(h.nodes.get('#auth-open').innerHTML, /可直接阅读|无需登录/);
});
test('session restoration has a short independent request budget', async () => {
  let options;
  const h = harness(async (_url, opts) => { options = opts; return { user: null }; });
  await h.ctx.loadMe();
  assert.ok(options.timeoutMs <= 4000);
  assert.equal(h.state.authReady, true);
});
test('a late restoration result cannot replace a user who just signed in', async () => {
  let respond;
  const h = harness(() => new Promise(resolve => { respond = resolve; }));
  const pending = h.ctx.loadMe();
  h.ctx.setCurrentUser({ id: 'new-login', displayName: 'new' });
  respond({ user: null });
  await pending;
  assert.equal(h.state.me.id, 'new-login');
});
test('a late restoration result cannot sign a user back in after logout', async () => {
  let respond;
  const h = harness(() => new Promise(resolve => { respond = resolve; }));
  const pending = h.ctx.loadMe();
  h.ctx.setCurrentUser(null);
  respond({ user: { id: 'old-session' } });
  await pending;
  assert.equal(h.state.me, null);
});
