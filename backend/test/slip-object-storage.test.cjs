const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createObjectKey,
  createObjectSlipStorage,
} = require('../src/slip-storage.cjs');
const { createSlipRetention } = require('../src/slip-retention.cjs');

const png = Buffer.from('89504e470d0a1a0a4f424a454354', 'hex');
const uuid = '12345678-1234-4123-8123-123456789abc';
const config = { objectStorageBucket: 'private-slips' };

function fakeClient(handler = async () => ({})) {
  const commands = [];
  return {
    commands,
    async send(command) {
      commands.push(command);
      return handler(command);
    },
  };
}

test('S3-compatible storage uploads private objects under deterministic safe keys', async () => {
  const client = fakeClient();
  const storage = createObjectSlipStorage(config, {
    client,
    randomUUID: () => uuid,
    now: () => Date.UTC(2026, 9, 2),
  });
  const stored = await storage.put({ paymentId: 99, buffer: png, contentType: 'image/png' });
  assert.equal(stored.objectKey, `slips/2026/10/${uuid}.png`);
  assert.match(stored.fileHash, /^[0-9a-f]{64}$/);
  assert.equal(client.commands[0].constructor.name, 'PutObjectCommand');
  assert.deepEqual(client.commands[0].input, {
    Bucket: 'private-slips',
    Key: stored.objectKey,
    Body: png,
    ContentType: 'image/png',
  });
  assert.equal(client.commands[0].input.ACL, undefined);
  assert.equal(stored.objectKey.includes('99'), false);
});

test('object key generation rejects unsafe UUIDs and does not use original filenames', () => {
  assert.equal(
    createObjectKey('jpg', { randomUUID: () => uuid, now: () => Date.UTC(2025, 0, 1) }),
    `slips/2025/01/${uuid}.jpg`,
  );
  assert.throws(
    () => createObjectKey('png', { randomUUID: () => '../../customer-slip', now: Date.now }),
    /invalid UUID/,
  );
});

test('S3-compatible storage supports head and delete without exposing a public URL', async () => {
  let present = true;
  const client = fakeClient(async (command) => {
    if (command.constructor.name === 'HeadObjectCommand' && !present) {
      const error = new Error('missing');
      error.$metadata = { httpStatusCode: 404 };
      throw error;
    }
    if (command.constructor.name === 'DeleteObjectCommand') present = false;
    return {};
  });
  const storage = createObjectSlipStorage(config, { client, randomUUID: () => uuid });
  const key = `slips/2026/10/${uuid}.png`;
  assert.equal(await storage.exists(key), true);
  await storage.remove(key);
  assert.equal(await storage.exists(key), false);
  assert.equal(storage.publicUrl, undefined);
  assert.deepEqual(client.commands.map((command) => command.constructor.name), [
    'HeadObjectCommand', 'DeleteObjectCommand', 'HeadObjectCommand',
  ]);
});

test('upload, delete and non-404 head failures are propagated', async () => {
  const uploadError = Object.assign(new Error('upload failed'), { code: 'S3_UPLOAD_FAILED' });
  const uploadStorage = createObjectSlipStorage(config, {
    client: fakeClient(async () => { throw uploadError; }), randomUUID: () => uuid,
  });
  await assert.rejects(uploadStorage.put({ buffer: png, contentType: 'image/png' }), uploadError);

  const deleteError = Object.assign(new Error('delete failed'), { code: 'S3_DELETE_FAILED' });
  const deleteStorage = createObjectSlipStorage(config, {
    client: fakeClient(async () => { throw deleteError; }), randomUUID: () => uuid,
  });
  const key = `slips/2026/10/${uuid}.png`;
  await assert.rejects(deleteStorage.remove(key), deleteError);
  await assert.rejects(deleteStorage.exists(key), deleteError);
  await assert.rejects(uploadStorage.put({ buffer: png, contentType: 'image/jpeg' }), /supported image/);
});

test('retention logs only safe error metadata when provider deletion fails', async () => {
  const row = { id: 42, object_key: `slips/2026/10/${uuid}.png` };
  const db = (table) => {
    const builder = {
      select() { return this; },
      whereNull() { return this; },
      whereNotNull() { return this; },
      where() { return this; },
      orderBy() { return this; },
      limit() { return Promise.resolve(table === 'payment_slips' ? [row] : []); },
      update() { return Promise.resolve(0); },
    };
    return builder;
  };
  db.fn = { now: () => new Date() };
  const entries = [];
  const secret = 'must-never-appear-in-logs';
  const retention = createSlipRetention({
    db,
    storage: { remove: async () => { throw Object.assign(new Error(secret), { code: 'S3_ACCESS_DENIED' }); } },
    logger: { error: (...args) => entries.push(args) },
  });
  assert.equal(await retention.purgeBatch(), 0);
  assert.equal(JSON.stringify(entries).includes(secret), false);
  assert.deepEqual(entries[0], ['Slip retention cleanup failed', { slip_id: 42, code: 'S3_ACCESS_DENIED' }]);
});
