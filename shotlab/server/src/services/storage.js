// Upload storage. STORAGE_DRIVER=local (dev, disk) | s3 (S3-compatible).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { env } from '../env.js';

const uploadRoot = path.resolve(process.cwd(), env.uploadDir);

export function ensureUploadDir() {
  if (env.storageDriver === 'local' && !fs.existsSync(uploadRoot)) {
    fs.mkdirSync(uploadRoot, { recursive: true });
  }
}

export function newFileId() {
  return 'f_' + crypto.randomBytes(12).toString('hex');
}

// Persist a multer in-memory file. Returns { path, url, storage }.
export async function saveFile({ fileId, buffer, mimeType, ext }) {
  if (env.storageDriver === 's3') {
    return saveToS3({ fileId, buffer, mimeType, ext });
  }
  ensureUploadDir();
  const filename = `${fileId}${ext || ''}`;
  const dest = path.join(uploadRoot, filename);
  await fs.promises.writeFile(dest, buffer);
  return { storage: 'local', path: filename, url: `/uploads/${filename}` };
}

async function saveToS3({ fileId, buffer, mimeType, ext }) {
  // Lazy import so the aws sdk is only needed when S3 is actually configured.
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: env.s3.endpoint || undefined,
    region: env.s3.region,
    forcePathStyle: !!env.s3.endpoint,
    credentials: { accessKeyId: env.s3.accessKey, secretAccessKey: env.s3.secretKey },
  });
  const key = `shotlab/${fileId}${ext || ''}`;
  await client.send(
    new PutObjectCommand({ Bucket: env.s3.bucket, Key: key, Body: buffer, ContentType: mimeType })
  );
  const base = env.s3.publicBase || `${env.s3.endpoint}/${env.s3.bucket}`;
  return { storage: 's3', path: key, url: `${base}/${key}` };
}

export function localFilePath(relPath) {
  return path.join(uploadRoot, relPath);
}

// Returns a URL the LLM can actually read for an uploaded image reference.
// - s3 with a public URL → the public URL as-is.
// - local disk → an inline base64 data URL (OpenAI/Anthropic cannot fetch a
//   localhost URL, so we embed the bytes directly).
export function imageReferenceUrl(upload) {
  if (upload.storage === 's3' && /^https?:\/\//i.test(upload.url)) return upload.url;
  const buf = fs.readFileSync(localFilePath(upload.path));
  return `data:${upload.mimeType};base64,${buf.toString('base64')}`;
}

// Absolute, browser-reachable URL for a stored file (used when handing an image
// reference to the model, which needs a fully-qualified URL).
export function absoluteUrl(req, url) {
  if (/^https?:\/\//i.test(url)) return url;
  return `${req.protocol}://${req.get('host')}${url}`;
}
