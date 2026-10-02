const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createIdempotencyStore, payloadHash } = require('../src/idempotency.cjs');

test('idempotency shares concurrent work and rejects key reuse with different data', async () => {
  const store = createIdempotencyStore();
  let calls = 0;
  let release;
  const operation = () => { calls++; return new Promise((resolve) => { release = resolve; }); };
  const first = store.execute({ scope: 'customer:1', key: 'same-request-key', payload: { a: 1, b: 2 }, operation });
  await new Promise((resolve) => setImmediate(resolve));
  const second = store.execute({ scope: 'customer:1', key: 'same-request-key', payload: { b: 2, a: 1 }, operation });
  await assert.rejects(
    () => store.execute({ scope: 'customer:1', key: 'same-request-key', payload: { a: 2 }, operation }),
    (error) => error.code === 'idempotency_conflict',
  );
  assert.equal(calls, 1);
  release({ id: 9 });
  assert.deepEqual(await first, { value: { id: 9 }, replayed: false });
  assert.deepEqual(await second, { value: { id: 9 }, replayed: true });
});

test('failed work is retryable and payload hashing is canonical', async () => {
  const store = createIdempotencyStore();
  let calls = 0;
  await assert.rejects(() => store.execute({
    scope: 'customer:1', key: 'retryable-key', payload: { nested: { z: 1, a: 2 } },
    operation: async () => { calls++; throw new Error('failed'); },
  }));
  const result = await store.execute({
    scope: 'customer:1', key: 'retryable-key', payload: { nested: { a: 2, z: 1 } },
    operation: async () => { calls++; return 'ok'; },
  });
  assert.equal(calls, 2);
  assert.equal(result.value, 'ok');
  assert.equal(payloadHash({ b: 2, a: 1 }), payloadHash({ a: 1, b: 2 }));
});
