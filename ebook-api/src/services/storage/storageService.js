const crypto = require('crypto');
const { Readable } = require('stream');
const {
  S3Client,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand
} = require('@aws-sdk/client-s3');
const { storageObjectRepository } = require('../../repositories');

const bucket = process.env.S3_BUCKET || 'ebook';
const region = process.env.S3_REGION || 'us-east-1';

function booleanEnv(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

const client = new S3Client({
  region,
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: booleanEnv(process.env.S3_FORCE_PATH_STYLE, Boolean(process.env.S3_ENDPOINT)),
  credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    }
    : undefined
});

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function toBody(input) {
  if (Buffer.isBuffer(input) || typeof input === 'string' || input instanceof Uint8Array) return input;
  if (input instanceof Readable) return input;
  return Readable.from(input);
}

async function ensureBucket() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
}

async function putObject(key, body, options = {}) {
  const normalizedBody = toBody(body);
  const buffer = Buffer.isBuffer(normalizedBody) ? normalizedBody : await streamToBuffer(normalizedBody);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  await ensureBucket();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: options.contentType || options.content_type || 'application/octet-stream',
    Metadata: options.metadata || undefined
  }));
  if (options.record !== false) {
    await storageObjectRepository.upsert({
      object_key: key,
      bucket,
      content_type: options.contentType || options.content_type || null,
      byte_size: buffer.length,
      sha256,
      entity_type: options.entityType || options.entity_type || null,
      entity_id: options.entityId || options.entity_id || null,
      metadata: options.metadata || null
    });
  }
  return {
    bucket,
    key,
    size: buffer.length,
    sha256
  };
}

async function getObjectStream(key) {
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return {
    stream: response.Body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    metadata: response.Metadata || {}
  };
}

async function getObjectBuffer(key) {
  const object = await getObjectStream(key);
  return streamToBuffer(object.stream);
}

async function deleteObject(key) {
  if (!key) return false;
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  await storageObjectRepository.deleteByKey(key);
  return true;
}

async function headObject(key) {
  try {
    return await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

async function listObjects(prefix = '') {
  const objects = [];
  let ContinuationToken;
  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken
    }));
    objects.push(...(response.Contents || []));
    ContinuationToken = response.NextContinuationToken;
  } while (ContinuationToken);
  return objects;
}

async function ping() {
  await ensureBucket();
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  return true;
}

module.exports = {
  bucket,
  client,
  deleteObject,
  ensureBucket,
  getObjectBuffer,
  getObjectStream,
  headObject,
  listObjects,
  ping,
  putObject,
  streamToBuffer
};
