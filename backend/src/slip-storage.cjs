const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');

const imageTypes = [
  { contentType: 'image/png', extension: 'png', matches: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { contentType: 'image/jpeg', extension: 'jpg', matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { contentType: 'image/webp', extension: 'webp', matches: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

function detectImage(buffer) {
  return imageTypes.find((type) => type.matches(buffer)) || null;
}

function createLocalSlipStorage({ rootDir, randomUUID = crypto.randomUUID }) {
  const absoluteRoot = path.resolve(rootDir);

  async function put({ paymentId, buffer, contentType, namespace = 'slips', merchantId }) {
    const detected = detectImage(buffer);
    if (!detected || detected.contentType !== contentType) {
      const error = new Error('File content is not a supported image');
      error.code = 'unsupported_slip_image';
      throw error;
    }
    const date = new Date();
    if (!['slips', 'banners', 'menu', 'merchant', 'finance-proofs'].includes(namespace)) throw new Error('Unsupported storage namespace');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const objectKey = ['menu','merchant'].includes(namespace) ? createObjectKey(detected.extension, {randomUUID, now:Date.now, namespace, merchantId}) : namespace === 'slips'
      ? path.posix.join('slips', `${date.getUTCFullYear()}-${month}`, `payment-${paymentId}-${randomUUID()}.${detected.extension}`)
      : path.posix.join(namespace, String(date.getUTCFullYear()), month, `${randomUUID()}.${detected.extension}`);
    const destination = path.resolve(absoluteRoot, ...objectKey.split('/'));
    if (!destination.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error('Unsafe slip object key');
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer, { flag: 'wx', mode: 0o600 });
    return { objectKey, fileHash: crypto.createHash('sha256').update(buffer).digest('hex') };
  }

  async function remove(objectKey) {
    const destination = path.resolve(absoluteRoot, ...String(objectKey).split('/'));
    if (!destination.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error('Unsafe slip object key');
    await fs.rm(destination, { force: true });
  }

  async function read(objectKey) {
    const destination = path.resolve(absoluteRoot, ...String(objectKey).split('/'));
    if (!destination.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error('Unsafe object key');
    const buffer = await fs.readFile(destination);
    const detected = detectImage(buffer);
    if (!detected) throw new Error('Stored object is not a supported image');
    return { buffer, contentType: detected.contentType };
  }

  return { put, remove, read, rootDir: absoluteRoot, mode: 'local', productionReady: true };
}

function createS3Client(config) {
  return new S3Client({
    endpoint: config.objectStorageEndpoint.href,
    region: config.objectStorageRegion,
    forcePathStyle: config.objectStorageForcePathStyle,
    credentials: {
      accessKeyId: config.objectStorageAccessKey,
      secretAccessKey: config.objectStorageSecretKey,
    },
    ...(config.objectStorageCa ? {
      requestHandler: new NodeHttpHandler({
        httpsAgent: new https.Agent({ ca: config.objectStorageCa, rejectUnauthorized: true }),
      }),
    } : {}),
  });
}

function createObjectKey(extension, { randomUUID, now, namespace = 'slips', merchantId }) {
  if (!['slips', 'banners','menu','merchant','finance-proofs'].includes(namespace)) throw new Error('Unsupported storage namespace');
  const id = randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Object storage key generator returned an invalid UUID');
  }
  if (['menu','merchant'].includes(namespace)) {
    if (!/^[1-9]\d*$/.test(String(merchantId))) throw new Error('Invalid merchant storage namespace');
    return `${namespace}/${merchantId}/${id}.${extension}`;
  }
  const date = new Date(now());
  if (Number.isNaN(date.valueOf())) throw new Error('Object storage key generator returned an invalid date');
  return path.posix.join(
    namespace,
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    `${id}.${extension}`,
  );
}

function assertObjectKey(objectKey) {
  if (!/^(?:(?:menu|merchant)\/[1-9]\d*\/[0-9a-f-]{36}\.(?:png|jpg|webp)|(?:slips|banners|finance-proofs)\/\d{4}\/\d{2}\/[0-9a-f-]+\.(?:png|jpg|webp))$/i.test(String(objectKey))) {
    const error = new Error('Unsafe storage object key');
    error.code = 'unsafe_storage_object_key';
    throw error;
  }
}

function isMissingObject(error) {
  return error?.name === 'NotFound'
    || error?.name === 'NoSuchKey'
    || error?.Code === 'NoSuchKey'
    || error?.$metadata?.httpStatusCode === 404;
}

function createObjectSlipStorage(config, {
  client = createS3Client(config),
  randomUUID = crypto.randomUUID,
  now = Date.now,
} = {}) {
  const bucket = config.objectStorageBucket;

  async function put({ buffer, contentType, namespace = 'slips', merchantId }) {
    const detected = detectImage(buffer);
    if (!detected || detected.contentType !== contentType) {
      const error = new Error('File content is not a supported image');
      error.code = 'unsupported_slip_image';
      throw error;
    }
    const objectKey = createObjectKey(detected.extension, { randomUUID, now, namespace, merchantId });
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: detected.contentType,
    }));
    return { objectKey, fileHash: crypto.createHash('sha256').update(buffer).digest('hex') };
  }

  async function remove(objectKey) {
    assertObjectKey(objectKey);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
  }

  async function exists(objectKey) {
    assertObjectKey(objectKey);
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
      return true;
    } catch (error) {
      if (isMissingObject(error)) return false;
      throw error;
    }
  }

  async function read(objectKey) {
    assertObjectKey(objectKey);
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (!response.Body?.transformToByteArray) throw new Error('Object storage returned an unreadable body');
    return {
      buffer: Buffer.from(await response.Body.transformToByteArray()),
      contentType: response.ContentType || 'application/octet-stream',
    };
  }

  return {
    put,
    remove,
    exists,
    read,
    mode: 'object',
    bucket,
    productionReady: true,
  };
}

function createSlipStorage(config, dependencies = {}) {
  return config.storageMode === 'local'
    ? createLocalSlipStorage({ rootDir: config.storageRoot, ...dependencies })
    : createObjectSlipStorage(config, dependencies);
}

module.exports = {
  createLocalSlipStorage,
  createObjectKey,
  createObjectSlipStorage,
  createS3Client,
  createSlipStorage,
  detectImage,
};
