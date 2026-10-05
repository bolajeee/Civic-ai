import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { GovernmentApi } from '../src/api';
import type { Session } from '../src/types';

const original: Session = { accessToken: 'old-access', refreshToken: 'old-refresh',
  user: { id: 'operator-id', email: 'operator@example.gov', role: 'OPERATOR' } };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('default transport invokes native fetch with its browser receiver', async () => {
  const transport = mock.method(globalThis, 'fetch', async function(this: unknown) {
    assert.equal(this, globalThis);
    return response(original);
  });
  try {
    const api = new GovernmentApi(() => {});
    await api.login(original.user.email, 'password');
    assert.equal(transport.mock.callCount(), 1);
  } finally { transport.mock.restore(); }
});

test('concurrent expired reads share one refresh and retry with the rotated token', async () => {
  let rotations = 0;
  let current: Session | null = null;
  const transport: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/login')) return response(original);
    if (String(url).endsWith('/refresh')) {
      rotations++;
      assert.deepEqual(JSON.parse(String(init?.body)), { userId: 'operator-id', refreshToken: 'old-refresh' });
      await new Promise(resolve => setTimeout(resolve, 10));
      return response({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    }
    const token = new Headers(init?.headers).get('Authorization');
    return token === 'Bearer old-access' ? response({ error: 'Unauthorized' }, 401) : response({ reports: { total: 40 } });
  };
  const api = new GovernmentApi(value => { current = value; }, transport);
  await api.login(original.user.email, 'password');
  const results = await Promise.all([api.overview(), api.overview()]);
  assert.equal(rotations, 1);
  assert.equal(results[0].reports.total, 40);
  assert.equal(results[1].reports.total, 40);
  assert.equal((current as Session | null)?.refreshToken, 'new-refresh');
});

test('logout after token expiry revokes the rotated refresh token', async () => {
  let current: Session | null = null;
  const bodies: unknown[] = [];
  const api = new GovernmentApi(value => { current = value; }, async (url, init) => {
    if (String(url).endsWith('/login')) return response(original);
    if (String(url).endsWith('/refresh')) return response({ accessToken: 'new-access', refreshToken: 'new-refresh' });
    if (new Headers(init?.headers).get('Authorization') === 'Bearer old-access') return response({}, 401);
    bodies.push(JSON.parse(String(init?.body)));
    return response({ message: 'Logged out' });
  });
  await api.login(original.user.email, 'password');
  await api.logout();
  assert.deepEqual(bodies, [{ refreshToken: 'new-refresh' }]);
  assert.equal(current, null);
  await assert.rejects(api.overview(), /Please sign in/);
});

test('role revocation clears the session without attempting refresh', async () => {
  let current: Session | null = null;
  let rotations = 0;
  const api = new GovernmentApi(value => { current = value; }, async url => {
    if (String(url).endsWith('/login')) return response(original);
    if (String(url).endsWith('/refresh')) rotations++;
    return response({ error: 'Access denied' }, 403);
  });
  await api.login(original.user.email, 'password');
  await assert.rejects(api.overview(), /Access denied/);
  assert.equal(current, null);
  assert.equal(rotations, 0);
});

test('failed refresh clears session; transient overview errors preserve it', async () => {
  for (const status of [401, 500]) {
    let current: Session | null = null;
    const api = new GovernmentApi(value => { current = value; }, async url =>
      String(url).endsWith('/login') ? response(original) : response({ error: 'Request failed' }, status));
    await api.login(original.user.email, 'password');
    await assert.rejects(api.overview());
    assert.equal(current === null, status === 401);
  }
});

test('server revocation failure still clears local credentials', async () => {
  let current: Session | null = null;
  const api = new GovernmentApi(value => { current = value; }, async url =>
    String(url).endsWith('/login') ? response(original) : response({}, 500));
  await api.login(original.user.email, 'password');
  await assert.rejects(api.logout());
  assert.equal(current, null);
});
