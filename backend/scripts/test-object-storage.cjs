require('../src/env.cjs');
const { paymentConfig } = require('../src/config.cjs');
const { createSlipStorage } = require('../src/slip-storage.cjs');

const required = [
  'SLIP_OBJECT_STORAGE_ENDPOINT',
  'SLIP_OBJECT_STORAGE_REGION',
  'SLIP_OBJECT_STORAGE_BUCKET',
  'SLIP_OBJECT_STORAGE_ACCESS_KEY',
  'SLIP_OBJECT_STORAGE_SECRET_KEY',
];

async function main() {
  const missing = required.filter((name) => !process.env[name]);
  if (process.env.SLIP_STORAGE_MODE !== 'object' || missing.length) {
    console.log('NOT RUN — credentials unavailable');
    return;
  }

  const storage = createSlipStorage(paymentConfig(process.env));
  let objectKey = null;
  try {
    const stored = await storage.put({
      paymentId: 'manual-object-storage-test',
      contentType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a4f424a4543542d53544f524147452d54455354', 'hex'),
    });
    objectKey = stored.objectKey;
    if (!await storage.exists(objectKey)) throw new Error('Uploaded object was not found by HeadObject');
    await storage.remove(objectKey);
    if (await storage.exists(objectKey)) throw new Error('Deleted object is still present');
    console.log('PASS object storage upload, head and delete');
  } finally {
    if (objectKey) {
      try {
        if (await storage.exists(objectKey)) await storage.remove(objectKey);
      } catch (error) {
        console.error('Object storage cleanup failed', { code: error.code || error.name || 'storage_error' });
        process.exitCode = 1;
      }
    }
  }
}

main().catch((error) => {
  console.error('Object storage integration test failed', { code: error.code || error.name || 'storage_error' });
  process.exitCode = 1;
});
