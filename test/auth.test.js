import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import app from '../src/index.js';

async function hashPassword(password, salt, iterations) {
  const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  // In tests, salt is a plain string; in production, it's base64.
  let saltBuffer;
  try {
    saltBuffer = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
  } catch {
    saltBuffer = new TextEncoder().encode(salt);
  }
  const bits = await webcrypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: saltBuffer,
    iterations,
    hash: 'SHA-256'
  }, key, 256);
  return Buffer.from(bits).toString('base64');
}

function databaseFor(user) {
  return {
    prepare(query) {
      let values = [];
      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async first() {
          return query.startsWith('SELECT u.id, u.username, u.role')
            && (user.username === values[0] || user.employee_id?.toLowerCase() === values[1]?.toLowerCase())
            ? { ...user, is_active: 1 }
            : null;
        },
        async all() {
          if (!query.includes('FROM user_access_roles')) return { results: [] };
          const code = { admin: 'super_admin', hr: 'hr_admin', payroll: 'finance', employee: 'employee' }[user.role];
          return { results: code ? [{ code }] : [] };
        },
        async run() {
          if (query.startsWith('UPDATE users SET password_salt')) {
            [user.password_salt, user.password_hash] = values;
          }
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
}

async function login(user, password, identifier = user.username, rememberMe = false) {
  return app.fetch(new Request('https://salary-desk.test/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password, rememberMe })
  }), { DB: databaseFor(user) });
}

function recoveryDatabase(user, sessions = []) {
  let challenge = null;
  return {
    prepare(query) {
      let values = [];
      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async first() {
          const matchesRecoveryIdentifier = (identifier) => user.username === identifier
            || user.employee_id?.toLowerCase() === identifier?.toLowerCase()
            || user.recovery_email?.toLowerCase() === identifier?.toLowerCase()
            || user.employee_email?.toLowerCase() === identifier?.toLowerCase();
          if (query.startsWith('SELECT u.id, u.username, u.role')) {
            return user.username === values[0] || user.employee_id?.toLowerCase() === values[1]?.toLowerCase()
              ? { ...user, is_active: 1 }
              : null;
          }
          if (query.startsWith('SELECT users.id, users.recovery_email')) {
            return matchesRecoveryIdentifier(values[0])
              ? { id: user.id, recovery_email: user.recovery_email || '', employee_email: user.employee_email || '' }
              : null;
          }
          if (query.startsWith('SELECT users.id, users.username')) {
            return matchesRecoveryIdentifier(values[0])
              ? { ...user }
              : null;
          }
          if (query.startsWith('SELECT last_sent_at')) {
            return challenge ? { last_sent_at: challenge.last_sent_at } : null;
          }
          if (query.startsWith('SELECT salt, code_hash, attempts, expires_at')) {
            return challenge ? { ...challenge } : null;
          }
          return null;
        },
        async all() {
          if (!query.includes('FROM user_access_roles')) return { results: [] };
          const code = { admin: 'super_admin', hr: 'hr_admin', payroll: 'finance', employee: 'employee' }[user.role];
          return { results: code ? [{ code }] : [] };
        },
        async run() {
          if (query.startsWith('INSERT INTO auth_recovery_challenges')) {
            challenge = {
              user_id: values[0],
              salt: values[1],
              code_hash: values[2],
              attempts: 0,
              expires_at: values[3],
              last_sent_at: values[4]
            };
            return { meta: { changes: 1 } };
          }
          if (query.startsWith('UPDATE auth_recovery_challenges SET attempts')) {
            if (!challenge || challenge.user_id !== values[0] || challenge.attempts >= values[2]) {
              return { meta: { changes: 0 } };
            }
            challenge.attempts += 1;
            return { meta: { changes: 1 } };
          }
          if (query.startsWith('DELETE FROM auth_recovery_challenges WHERE user_id = ? AND code_hash = ?')) {
            if (challenge?.user_id !== values[0] || challenge.code_hash !== values[1]) {
              return { meta: { changes: 0 } };
            }
            challenge = null;
            return { meta: { changes: 1 } };
          }
          if (query.startsWith('DELETE FROM auth_recovery_challenges WHERE user_id = ?')) {
            challenge = null;
            return { meta: { changes: 1 } };
          }
          if (query.startsWith('UPDATE users SET password_salt')) {
            [user.password_salt, user.password_hash] = values;
            return { meta: { changes: 1 } };
          }
          if (query.startsWith('DELETE FROM sessions WHERE user_id = ?')) {
            const remaining = sessions.filter((session) => session.user_id !== values[0]);
            const changes = sessions.length - remaining.length;
            sessions.splice(0, sessions.length, ...remaining);
            return { meta: { changes } };
          }
          return { meta: { changes: 0 } };
        }
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
}

function userManagementDatabase(users, sessions) {
  return {
    prepare(query) {
      let values = [];
      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async first() {
          if (query.includes('FROM sessions JOIN users')) {
            return values[0] === sessions[0]?.token_hash
              ? users.find((user) => user.id === sessions[0].user_id) || null
              : null;
          }
          if (query.includes('FROM user_access_roles assignment')) {
            const actor = users.find((user) => user.id === values[0]);
            if (query.includes('access_role_permissions')) {
              return actor?.role === 'admin' ? { allowed: 1 } : null;
            }
            const code = { admin: 'super_admin', hr: 'hr_admin', payroll: 'finance', employee: 'employee' }[actor?.role];
            return code === values[1] ? { allowed: 1 } : null;
          }
          if (query === 'SELECT id FROM users WHERE id = ?') {
            return users.find((user) => user.id === values[0]) || null;
          }
          if (query === 'SELECT id, role FROM users WHERE id = ?') {
            const user = users.find((row) => row.id === values[0]);
            return user ? { id: user.id, role: user.role } : null;
          }
          return null;
        },
        async all() {
          if (!query.includes('FROM user_access_roles')) return { results: [] };
          const user = users.find((row) => row.id === sessions[0]?.user_id);
          const code = { admin: 'super_admin', hr: 'hr_admin', payroll: 'finance', employee: 'employee' }[user?.role];
          return { results: code ? [{ code }] : [] };
        },
        async run() {
          if (query.startsWith('UPDATE users SET recovery_email')) {
            const user = users.find((row) => row.id === values[1]);
            if (user) user.recovery_email = values[0];
            return { meta: { changes: user ? 1 : 0 } };
          }
          if (query.startsWith('UPDATE users SET password_salt')) {
            const user = users.find((row) => row.id === values[2]);
            if (user) [user.password_salt, user.password_hash] = values;
            return { meta: { changes: user ? 1 : 0 } };
          }
          if (query.startsWith('DELETE FROM sessions WHERE user_id = ?')) {
            const remaining = sessions.filter((session) => session.user_id !== values[0]);
            const changes = sessions.length - remaining.length;
            sessions.splice(0, sessions.length, ...remaining);
            return { meta: { changes } };
          }
          if (query.startsWith('DELETE FROM users')) {
            const index = users.findIndex((user) => user.id === values[0]);
            if (index < 0 || (users[index].role === 'admin' && users.filter((user) => user.role === 'admin').length <= 1)) {
              return { meta: { changes: 0 } };
            }
            const [removedUser] = users.splice(index, 1);
            const remainingSessions = sessions.filter((session) => session.user_id !== removedUser.id);
            sessions.splice(0, sessions.length, ...remainingSessions);
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
        }
      };
      return statement;
    },
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
}

async function authenticatedRequest(path, { method = 'GET', body } = {}, users, sessions) {
  const token = 'admin-session-token';
  const tokenHash = Buffer.from(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
    .toString('hex');
  sessions[0].token_hash = tokenHash;
  return app.fetch(new Request(`https://salary-desk.test${path}`, {
    method,
    headers: {
      Cookie: `salary_session=${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  }), { DB: userManagementDatabase(users, sessions) });
}

test('login upgrades legacy 100,000-iteration password hashes', async () => {
  const user = {
    id: 'user-1',
    username: 'employee',
    role: 'employee',
    employee_id: 'EMP001',
    password_salt: 'legacy-salt',
    password_hash: await hashPassword('correct-password', 'legacy-salt', 100_000)
  };

  const response = await login(user, 'correct-password');

  assert.equal(response.status, 200);
  assert.notEqual(user.password_salt, 'legacy-salt');
  assert.equal(user.password_hash, await hashPassword('correct-password', user.password_salt, 210_000));
  assert.match(response.headers.get('set-cookie') || '', /salary_session=/);
});

test('login upgrades legacy hashes stored with the raw base64 salt string as bytes', async () => {
  // Accounts created before the manual PBKDF2 implementation hashed with the
  // base64 salt string as raw bytes (not decoded) at 100,000 iterations.
  const rawSalt = 'legacy-base64-salt==';
  const user = {
    id: 'user-legacy',
    username: 'legacy-user',
    role: 'admin',
    employee_id: null,
    password_salt: rawSalt,
    password_hash: await hashPassword('correct-password', rawSalt, 100_000)
  };

  const response = await login(user, 'correct-password');

  assert.equal(response.status, 200);
  assert.notEqual(user.password_salt, rawSalt);
  assert.equal(user.password_hash, await hashPassword('correct-password', user.password_salt, 210_000));
  assert.match(response.headers.get('set-cookie') || '', /salary_session=/);
});

test('login accepts current password hashes and rejects incorrect passwords', async () => {
  const user = {
    id: 'user-2',
    username: 'admin',
    role: 'admin',
    employee_id: null,
    password_salt: 'current-salt',
    password_hash: await hashPassword('correct-password', 'current-salt', 210_000)
  };

  const validResponse = await login(user, 'correct-password');
  assert.equal(validResponse.status, 200);
  assert.equal(user.password_salt, 'current-salt');
  assert.match(validResponse.headers.get('set-cookie') || '', /Max-Age=604800/);

  const invalidResponse = await login(user, 'incorrect-password');
  assert.equal(invalidResponse.status, 401);
  assert.deepEqual(await invalidResponse.json(), { error: 'Invalid username or password.' });
});

test('employees can log in with employee ID and opt into a 30-day session', async () => {
  const user = {
    id: 'employee-user',
    username: 'employee-account',
    role: 'employee',
    employee_id: 'EMP001',
    password_salt: 'current-salt',
    password_hash: await hashPassword('correct-password', 'current-salt', 210_000)
  };

  const response = await login(user, 'correct-password', 'emp001', true);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=2592000/);
  const body = await response.json();
  assert.equal(body.user.employee_id, 'EMP001');
});

test('email recovery can use the recovery email as the identifier', async () => {
  const user = {
    id: 'employee-user',
    username: 'employee-account',
    role: 'employee',
    employee_id: 'EMP001',
    recovery_email: '',
    employee_email: 'employee@example.com',
    password_salt: 'old-salt',
    password_hash: 'old-hash'
  };
  const sessions = [{ user_id: user.id }, { user_id: 'admin' }];
  const DB = recoveryDatabase(user, sessions);
  const env = {
    DB,
    RESEND_API_KEY: 'test-resend-key',
    AUTH_EMAIL_FROM: 'Salary Desk <payroll@example.com>',
    AUTH_OTP_SECRET: 'test-otp-secret'
  };
  const originalFetch = globalThis.fetch;
  let emailPayload;
  globalThis.fetch = async (_url, options) => {
    emailPayload = JSON.parse(options.body);
    return new Response('{"id":"email-test"}', { status: 200 });
  };

  try {
    const request = await app.fetch(new Request('https://salary-desk.test/api/auth/recovery/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'employee@example.com' })
    }), env);
    assert.equal(request.status, 200);
    assert.equal((await request.json()).message.includes('If an account matches'), true);
    assert.deepEqual(emailPayload.to, ['employee@example.com']);

    const code = emailPayload.text.match(/\b\d{6}\b/)[0];
    const verify = await app.fetch(new Request('https://salary-desk.test/api/auth/recovery/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: 'employee@example.com',
        code,
        password: 'a-new-secure-password'
      })
    }), env);

    assert.equal(verify.status, 200);
    assert.equal(user.password_hash, await hashPassword('a-new-secure-password', user.password_salt, 210_000));
    assert.deepEqual(sessions.map((session) => session.user_id), ['admin']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('email recovery limits verification attempts and does not reveal unknown accounts', async () => {
  const user = {
    id: 'employee-user',
    username: 'employee-account',
    role: 'employee',
    employee_id: 'EMP001',
    recovery_email: 'employee@example.com',
    password_salt: 'old-salt',
    password_hash: 'old-hash'
  };
  const DB = recoveryDatabase(user);
  const env = {
    DB,
    RESEND_API_KEY: 'test-resend-key',
    AUTH_EMAIL_FROM: 'Salary Desk <payroll@example.com>',
    AUTH_OTP_SECRET: 'test-otp-secret'
  };
  const originalFetch = globalThis.fetch;
  let sentCode;
  let emailSendCount = 0;
  globalThis.fetch = async (_url, options) => {
    emailSendCount += 1;
    const email = JSON.parse(options.body);
    sentCode = email.text.match(/\b\d{6}\b/)[0];
    return new Response('{"id":"email-test"}', { status: 200 });
  };

  try {
    const unknownAccount = await app.fetch(new Request('https://salary-desk.test/api/auth/recovery/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'not-an-account' })
    }), env);
    const knownAccount = await app.fetch(new Request('https://salary-desk.test/api/auth/recovery/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'employee@example.com' })
    }), env);
    assert.deepEqual(await unknownAccount.json(), await knownAccount.json());
    assert.equal(emailSendCount, 1);

    const invalidCode = sentCode === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await app.fetch(new Request('https://salary-desk.test/api/auth/recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'employee@example.com',
          code: invalidCode,
          password: 'a-new-secure-password'
        })
      }), env);
      assert.equal(response.status, 400);
    }
    assert.equal(user.password_hash, 'old-hash');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('administrator password reset updates the hash and invalidates target sessions', async () => {
  const users = [
    { id: 'admin', username: 'admin', role: 'admin', employee_id: null },
    { id: 'employee', username: 'employee', role: 'employee', employee_id: 'EMP001', password_salt: 'old', password_hash: 'old-hash' }
  ];
  const sessions = [
    { user_id: 'admin', token_hash: '' },
    { user_id: 'employee', token_hash: 'employee-session' }
  ];

  const response = await authenticatedRequest('/api/users/employee/reset-password', {
    method: 'POST',
    body: { password: 'a-new-secure-password' }
  }, users, sessions);

  assert.equal(response.status, 200);
  assert.notEqual(users[1].password_salt, 'old');
  assert.notEqual(users[1].password_hash, 'old-hash');
  assert.deepEqual(sessions.map((session) => session.user_id), ['admin']);
});

test('administrator can configure a recovery email for an account', async () => {
  const users = [
    { id: 'admin', username: 'admin', role: 'admin' },
    { id: 'employee', username: 'employee', role: 'employee', employee_id: 'EMP001', recovery_email: '' }
  ];
  const sessions = [{ user_id: 'admin', token_hash: '' }, { user_id: 'employee', token_hash: 'employee-session' }];

  const response = await authenticatedRequest('/api/users/employee/recovery-email', {
    method: 'PUT',
    body: { recovery_email: 'employee@example.com' }
  }, users, sessions);

  assert.equal(response.status, 200);
  assert.equal(users[1].recovery_email, 'employee@example.com');
});

test('password reset validates length and user deletion prevents self-removal', async () => {
  const users = [
    { id: 'admin', username: 'admin', role: 'admin', employee_id: null },
    { id: 'employee', username: 'employee', role: 'employee', employee_id: 'EMP001' }
  ];
  const sessions = [{ user_id: 'admin', token_hash: '' }, { user_id: 'employee', token_hash: 'employee-session' }];
  const shortPassword = await authenticatedRequest('/api/users/admin/reset-password', {
    method: 'POST',
    body: { password: 'short' }
  }, users, sessions);
  assert.equal(shortPassword.status, 400);

  const selfDelete = await authenticatedRequest('/api/users/admin', { method: 'DELETE' }, users, sessions);
  assert.equal(selfDelete.status, 400);

  const removeEmployee = await authenticatedRequest('/api/users/employee', { method: 'DELETE' }, users, sessions);
  assert.equal(removeEmployee.status, 200);
  assert.deepEqual(users.map((user) => user.id), ['admin']);
  assert.deepEqual(sessions.map((session) => session.user_id), ['admin']);
});
