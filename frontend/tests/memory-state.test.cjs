const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { create, act } = require('react-test-renderer');
const { loadTS } = require('./helpers/load-ts.cjs');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const snapshot = (owner, revision = 1, enabled = true) => ({ enabled, revision, items: [{
  id: `mem_${owner}`, category: 'preferences', label: 'Favourite food', value: `${owner} private fact`,
  createdAt: 1, paused: false, source: 'Saved by you',
}] });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(overrides = {}) {
  let session = { token: 'token-a', user: { id: 'a' } };
  const listeners = new Set();
  const calls = [];
  const api = {
    APIError: class APIError extends Error {},
    fetchMemory: async (token) => snapshot(token === 'token-a' ? 'a' : 'b'),
    setMemoryEnabled: async (_token, enabled) => { calls.push('consent'); return snapshot('a', 2, enabled); },
    createMemory: async () => snapshot('a', 2),
    updateMemory: async () => snapshot('a', 2),
    deleteMemory: async () => ({ enabled: true, revision: 2, items: [] }),
    ...overrides,
  };
  const notify = () => listeners.forEach(fn => fn());
  const exported = loadTS('src/state/memory-context.tsx', {
    '@/data/mock-memory': { MEMORY_CATEGORY_ORDER: ['name', 'interests', 'relationships', 'preferences', 'plans'] },
    '@/lib/config': { hasBackend: true },
    '@/lib/api': api,
    '@/lib/session': {
      readSession: async () => session,
      subscribeSession: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
      clearSession: async () => { session = null; notify(); },
    },
  });
  let state;
  function Probe() { state = exported.useMemory(); return null; }
  let root;
  await act(async () => { root = create(React.createElement(exported.MemoryProvider, null, React.createElement(Probe))); });
  return {
    get state() { return state; }, calls, api,
    switchAccount: async (owner) => act(async () => { session = owner ? { token: `token-${owner}`, user: { id: owner } } : null; notify(); }),
    close: async () => act(async () => root.unmount()),
  };
}

test('server consent remains off until an explicit operation succeeds', async () => {
  const f = await fixture({ fetchMemory: async () => ({ enabled: false, revision: 0, items: [] }) });
  try {
    assert.equal(f.state.enabled, false);
    assert.equal(f.state.items.length, 0);
    assert.deepEqual(f.calls, []);
    await act(async () => { assert.equal(await f.state.setEnabled(true), true); });
    assert.equal(f.state.enabled, true);
    assert.deepEqual(f.calls, ['consent']);
  } finally { await f.close(); }
});

test('a pending correction never changes the displayed memory before confirmation', async () => {
  const pending = deferred();
  const f = await fixture({ updateMemory: () => pending.promise });
  try {
    let operation;
    await act(async () => { operation = f.state.correct('mem_a', 'new fact'); });
    assert.equal(f.state.items[0].value, 'a private fact');
    assert.equal(f.state.busy, true);
    await act(async () => { pending.resolve({ ...snapshot('a', 2), items: [{ ...snapshot('a').items[0], value: 'new fact' }] }); assert.equal(await operation, true); });
    assert.equal(f.state.items[0].value, 'new fact');
    assert.equal(f.state.busy, false);
  } finally { await f.close(); }
});

test('failed saving preserves existing memories and reports failure', async () => {
  const f = await fixture({ createMemory: async () => { throw new Error('Offline'); } });
  try {
    await act(async () => { assert.equal(await f.state.add({ category: 'name', label: 'Name', value: 'Ada' }), false); });
    assert.equal(f.state.items.length, 1);
    assert.equal(f.state.error, 'Offline');
    assert.equal(f.state.busy, false);
  } finally { await f.close(); }
});

test('a delayed fetch from the previous account cannot restore its private data', async () => {
  const pending = deferred();
  const f = await fixture({ fetchMemory: token => token === 'token-a' ? pending.promise : Promise.resolve(snapshot('b')) });
  try {
    await f.switchAccount('b');
    await act(async () => { pending.resolve(snapshot('a')); });
    assert.equal(f.state.accountID, 'b');
    assert.equal(f.state.items[0].value, 'b private fact');
    await f.switchAccount(null);
    assert.equal(f.state.status, 'unauthorized');
    assert.equal(f.state.items.length, 0);
    assert.equal(f.state.enabled, false);
  } finally { await f.close(); }
});

test('a delayed save cannot overwrite the next account or leave its controls busy', async () => {
  const pending = deferred();
  const f = await fixture({ updateMemory: () => pending.promise });
  try {
    let operation;
    await act(async () => { operation = f.state.correct('mem_a', 'old account correction'); });
    await f.switchAccount('b');
    await act(async () => { pending.resolve(snapshot('a', 2)); assert.equal(await operation, false); });
    assert.equal(f.state.accountID, 'b');
    assert.equal(f.state.items[0].value, 'b private fact');
    assert.equal(f.state.busy, false);
  } finally { await f.close(); }
});

test('an expired session clears private memories and consent from the UI', async () => {
  const f = await fixture();
  try {
    f.api.updateMemory = async () => { throw Object.assign(new f.api.APIError('Expired'), { status: 401 }); };
    await act(async () => { assert.equal(await f.state.correct('mem_a', 'update'), false); });
    assert.equal(f.state.status, 'unauthorized');
    assert.equal(f.state.accountID, null);
    assert.equal(f.state.items.length, 0);
    assert.equal(f.state.enabled, false);
    assert.equal(f.state.busy, false);
  } finally { await f.close(); }
});

test('callbacks from the previous account cannot save facts into the new account', async () => {
  let writes = 0;
  const f = await fixture({ createMemory: async () => { writes++; return snapshot('b', 2); } });
  try {
    const oldSave = f.state.add;
    await f.switchAccount('b');
    await act(async () => { assert.equal(await oldSave({ category: 'name', label: 'Old private name', value: 'Account A' }), false); });
    assert.equal(writes, 0);
    assert.equal(f.state.accountID, 'b');
    assert.equal(f.state.items[0].value, 'b private fact');
  } finally { await f.close(); }
});
