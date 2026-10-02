const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const {
  DeleteObjectCommand,
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

  async function put({ paymentId, buffer, contentType }) {
    const detected = detectImage(buffer);
    if (!detected || detected.contentType !== contentType) {
      const error = new Error('File content is not a supported image');
      error.code = 'unsupported_slip_image';
      throw error;
    }
    const date = new Date();
    const partition = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const objectKey = path.posix.join('slips', partition, `payment-${paymentId}-${randomUUID()}.${detected.extension}`);
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

  return { put, remove, rootDir: absoluteRoot, productionReady: true };
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

function createObjectKey(extension, { randomUUID, now }) {
  const id = randomUUID();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Object storage key generator returned an invalid UUID');
  }
  const date = new Date(now());
  if (Number.isNaN(date.valueOf())) throw new Error('Object storage key generator returned an invalid date');
  return path.posix.join(
    'slips',
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    `${id}.${extension}`,
  );
}

function assertObjectKey(objectKey) {
  if (!/^slips\/\d{4}\/\d{2}\/[0-9a-f-]+\.(?:png|jpg|webp)$/i.test(String(objectKey))) {
    const error = new Error('Unsafe slip object key');
    error.code = 'unsafe_slip_object_key';
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

  async function put({ buffer, contentType }) {
    const detected = detectImage(buffer);
    if (!detected || detected.contentType !== contentType) {
      const error = new Error('File content is not a supported image');
      error.code = 'unsupported_slip_image';
      throw error;
    }
    const objectKey = createObjectKey(detected.extension, { randomUUID, now });
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

  return {
    put,
    remove,
    exists,
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
