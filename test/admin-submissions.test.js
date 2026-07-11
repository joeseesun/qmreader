const { after, test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qmreader-admin-submissions-'));
process.env.QMREADER_DATA_DIR = testDataDir;

const store = require('../lib/store');

after(() => fs.rmSync(testDataDir, { recursive: true, force: true }));

function entry(id, title) {
  return {
    id,
    sourceId: 'user-submitted',
    title,
    link: `https://example.com/${id}`,
    author: '读者',
    published: new Date().toISOString(),
    publishedTs: Date.now(),
    summary: `${title} summary`,
    content: `<p>${title} content</p>`,
  };
}

function saveSubmission(id, title, user) {
  return store.saveSubmittedEntry(entry(id, title), {
    userId: user.id,
    author: user.displayName,
  });
}

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
}

function waitForServer(child, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server startup timed out')), timeout);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('QMReader listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(stderr || `server exited ${code}`));
    });
  });
}

test('admin page exposes an accessible user submission management workflow', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  for (const id of [
    'admin-submission-search-form',
    'admin-submission-search',
    'admin-submission-users',
    'admin-submission-detail',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /用户投稿管理/);
  assert.match(app, /async function loadAdminSubmissionUsers/);
  assert.match(app, /async function loadAdminUserSubmissions/);
  assert.match(app, /async function deleteAdminUserSubmissions/);
  assert.match(app, /async function deleteAdminUser/);
  assert.match(app, /showConfirmDialog/);
});

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('admin submission summaries and batch soft delete are scoped to one exact user', () => {
  const readerC = store.createUser({ email: uniqueEmail('reader-c'), password: 'password-123', displayName: 'c' });
  const sameName = store.createUser({ email: uniqueEmail('reader-c2'), password: 'password-123', displayName: 'c' });
  const other = store.createUser({ email: uniqueEmail('reader-d'), password: 'password-123', displayName: 'd' });
  saveSubmission('c-entry-one', 'C one', readerC);
  saveSubmission('c-entry-two', 'C two', readerC);
  saveSubmission('same-name-entry', 'Same name', sameName);
  saveSubmission('other-entry', 'Other', other);

  const users = store.getAdminSubmissionUsers({ q: 'c', limit: 20 });
  assert.equal(users.length, 2);
  assert.deepEqual(users.map(item => item.userId).sort(), [readerC.id, sameName.id].sort());
  assert.equal(users.find(item => item.userId === readerC.id).activeSubmissionCount, 2);

  const preview = store.getAdminUserSubmissions(readerC.id, { limit: 20 });
  assert.equal(preview.user.displayName, 'c');
  assert.equal(preview.user.email, readerC.email);
  assert.equal(preview.activeSubmissionCount, 2);
  assert.deepEqual(preview.submissions.map(item => item.entryId).sort(), ['c-entry-one', 'c-entry-two']);

  const result = store.softDeleteUserSubmissions(readerC.id, {
    deletedBy: 'admin-user-id',
    reason: '管理员批量删除用户投稿',
  });
  assert.equal(result.deletedCount, 2);
  assert.deepEqual(result.entryIds.sort(), ['c-entry-one', 'c-entry-two']);
  assert.equal(store.getEntry('c-entry-one'), null);
  assert.equal(store.getEntry('c-entry-two'), null);
  assert.ok(store.getEntry('same-name-entry'));
  assert.ok(store.getEntry('other-entry'));

  const afterDelete = store.getAdminUserSubmissions(readerC.id, { limit: 20 });
  assert.equal(afterDelete.activeSubmissionCount, 0);
  assert.equal(afterDelete.deletedSubmissionCount, 2);
  assert.ok(afterDelete.submissions.every(item => item.deletedAt));

  const idempotent = store.softDeleteUserSubmissions(readerC.id, {
    deletedBy: 'admin-user-id',
    reason: 'repeat',
  });
  assert.equal(idempotent.deletedCount, 0);
  assert.deepEqual(idempotent.entryIds, []);
  assert.throws(
    () => store.softDeleteUserSubmissions('missing-user', { deletedBy: 'admin-user-id' }),
    error => error.statusCode === 404
  );
});

test('moderation disables a non-admin user, revokes sessions, deletes submissions, and can be restored', () => {
  const admin = store.createUser({ email: uniqueEmail('moderator'), password: 'password-123', displayName: 'moderator', role: 'admin' });
  const offender = store.createUser({ email: uniqueEmail('offender'), password: 'password-123', displayName: '违规用户' });
  saveSubmission('offender-entry-one', 'Offender one', offender);
  saveSubmission('offender-entry-two', 'Offender two', offender);
  const session = store.createSession(offender.id);
  assert.equal(store.getUserBySessionToken(session.token).id, offender.id);

  const moderated = store.disableUserForModeration(offender.id, {
    adminUserId: admin.id,
    reason: '批量发布违规链接',
  });
  assert.equal(moderated.user.disabled, true);
  assert.equal(moderated.deletedSubmissionCount, 2);
  assert.equal(moderated.revokedSessionCount, 1);
  assert.equal(store.getUserBySessionToken(session.token), null);
  assert.equal(store.getEntry('offender-entry-one'), null);
  assert.throws(
    () => store.authenticateUser(offender.email, 'password-123'),
    error => error.statusCode === 403
  );
  assert.throws(
    () => store.disableUserForModeration(admin.id, { adminUserId: admin.id, reason: 'invalid' }),
    error => error.statusCode === 403
  );

  const restored = store.restoreModeratedUser(offender.id, { adminUserId: admin.id });
  assert.equal(restored.disabled, false);
  assert.equal(store.authenticateUser(offender.email, 'password-123').id, offender.id);
  assert.equal(store.getEntry('offender-entry-one'), null);
});

test('admin API previews and deletes one reader submissions with permission and confirmation gates', { timeout: 15000 }, async () => {
  const reader = store.createUser({ email: uniqueEmail('api-reader-c'), password: 'password-123', displayName: 'c' });
  const other = store.createUser({ email: uniqueEmail('api-reader-d'), password: 'password-123', displayName: 'd' });
  const offender = store.createUser({ email: uniqueEmail('api-offender'), password: 'password-123', displayName: '违规用户' });
  const guardUser = store.createUser({ email: uniqueEmail('api-guard'), password: 'password-123', displayName: 'guard' });
  saveSubmission('api-c-one', 'API C one', reader);
  saveSubmission('api-c-two', 'API C two', reader);
  saveSubmission('api-d-one', 'API D one', other);
  saveSubmission('api-offender-one', 'API offender one', offender);

  const port = 44000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminEmail = uniqueEmail('admin');
  const adminPassword = 'admin-password-123';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      STARTUP_REFRESH_DELAY_MS: '-1',
      FRESHNESS_SWEEP_INTERVAL_MS: '-1',
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD: adminPassword,
      ADMIN_NAME: 'Test Admin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(child);
    const adminCookie = await login(baseUrl, adminEmail, adminPassword);
    const readerCookie = await login(baseUrl, reader.email, 'password-123');
    const guardCookie = await login(baseUrl, guardUser.email, 'password-123');
    const adminMeResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: adminCookie } });
    const adminMe = (await adminMeResponse.json()).user;

    const anonymousSubmit = await fetch(`${baseUrl}/api/submit-link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(anonymousSubmit.status, 401);
    const registeredSubmit = await fetch(`${baseUrl}/api/submit-link`, {
      method: 'POST',
      headers: { Cookie: readerCookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(registeredSubmit.status, 400);
    const blockedProbe = await fetch(`${baseUrl}/api/submit-link`, {
      method: 'POST',
      headers: { Cookie: guardCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://[::ffff:7f00:1]:9001/metrics' }),
    });
    assert.equal(blockedProbe.status, 400);
    assert.match((await blockedProbe.json()).error, /内网|IP 地址/);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${baseUrl}/api/submit-link`, {
        method: 'POST',
        headers: { Cookie: guardCookie, 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 400);
    }
    const rateLimited = await fetch(`${baseUrl}/api/submit-link`, {
      method: 'POST',
      headers: { Cookie: guardCookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(rateLimited.status, 429);

    const anonymous = await fetch(`${baseUrl}/api/admin/submission-users`);
    assert.equal(anonymous.status, 403);
    const forbidden = await fetch(`${baseUrl}/api/admin/submission-users`, { headers: { Cookie: readerCookie } });
    assert.equal(forbidden.status, 403);

    const usersResponse = await fetch(`${baseUrl}/api/admin/submission-users?q=c`, { headers: { Cookie: adminCookie } });
    assert.equal(usersResponse.status, 200);
    const users = await usersResponse.json();
    assert.ok(users.users.some(item => item.userId === reader.id && item.activeSubmissionCount === 2));

    const allUsersResponse = await fetch(`${baseUrl}/api/admin/users?q=%E8%BF%9D%E8%A7%84`, { headers: { Cookie: adminCookie } });
    assert.equal(allUsersResponse.status, 200);
    const allUsers = await allUsersResponse.json();
    assert.ok(allUsers.users.some(item => item.userId === offender.id && item.disabled === false));

    const previewResponse = await fetch(`${baseUrl}/api/admin/users/${reader.id}/submissions`, { headers: { Cookie: adminCookie } });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.equal(preview.activeSubmissionCount, 2);

    const mismatch = await fetch(`${baseUrl}/api/admin/users/${reader.id}/submissions`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmUserId: other.id }),
    });
    assert.equal(mismatch.status, 400);

    const deletedResponse = await fetch(`${baseUrl}/api/admin/users/${reader.id}/submissions`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmUserId: reader.id }),
    });
    assert.equal(deletedResponse.status, 200);
    const deleted = await deletedResponse.json();
    assert.equal(deleted.deletedCount, 2);

    const entriesResponse = await fetch(`${baseUrl}/api/entries?source=user-submitted`, { headers: { Cookie: adminCookie } });
    assert.equal(entriesResponse.status, 200);
    const entries = await entriesResponse.json();
    assert.ok(entries.entries.some(item => item.id === 'api-d-one'));
    assert.ok(entries.entries.every(item => item.id !== 'api-c-one' && item.id !== 'api-c-two'));

    const forbiddenModeration = await fetch(`${baseUrl}/api/admin/users/${offender.id}`, {
      method: 'DELETE',
      headers: { Cookie: readerCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmUserId: offender.id, reason: 'spam' }),
    });
    assert.equal(forbiddenModeration.status, 403);
    const moderateResponse = await fetch(`${baseUrl}/api/admin/users/${offender.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmUserId: offender.id, reason: 'spam' }),
    });
    assert.equal(moderateResponse.status, 200);
    const moderated = await moderateResponse.json();
    assert.equal(moderated.user.disabled, true);
    assert.equal(moderated.deletedSubmissionCount, 1);
    const disabledLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: offender.email, password: 'password-123' }),
    });
    assert.equal(disabledLogin.status, 403);
    const selfDelete = await fetch(`${baseUrl}/api/admin/users/${adminMe.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmUserId: adminMe.id, reason: 'invalid' }),
    });
    assert.equal(selfDelete.status, 403);
    const restoreResponse = await fetch(`${baseUrl}/api/admin/users/${offender.id}/restore`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(restoreResponse.status, 200);
    assert.equal((await restoreResponse.json()).user.disabled, false);
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
});
