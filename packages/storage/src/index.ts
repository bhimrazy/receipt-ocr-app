import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { CLIENT_CACHE_MAX, configKey, LruCache } from "./client-cache";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type S3StorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

const clients = new LruCache<S3Client>(CLIENT_CACHE_MAX);

/** The cache keys, for tests: they must never contain the secret. */
export const s3CacheKeys = () => clients.keys();

/** One client per config (bounded LRU, keyed by a hash), so keep-alive connections and TLS sessions are reused. */
export function s3Client(config: S3StorageConfig): S3Client {
  const key = configKey([
    config.endpoint,
    config.region,
    config.accessKeyId,
    config.secretAccessKey,
    config.forcePathStyle,
  ]);
  let client = clients.get(key);
  if (!client) {
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    clients.set(key, client);
  }
  return client;
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

/** Keyed by id and sniffed type only: the client's file name never reaches the key. */
export function receiptObjectKey(userId: string, receiptId: string, mediaType: string) {
  return `users/${userId}/receipts/${receiptId}.${EXTENSIONS[mediaType] ?? "bin"}`;
}

export async function putObject(
  config: S3StorageConfig,
  input: { key: string; body: Uint8Array; contentType: string },
): Promise<void> {
  await s3Client(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
    }),
  );
}

export async function getObject(config: S3StorageConfig, key: string): Promise<Uint8Array> {
  const response = await s3Client(config).send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
  );
  if (!response.Body) throw new Error(`Object ${key} has no body`);
  return response.Body.transformToByteArray();
}

/**
 * Reachability and credentials check for health probes: a HEAD on a key that
 * need not exist. 200 or 404 means the bucket answered an authenticated request.
 * AWS S3 answers 403 for a missing key without s3:ListBucket, which reads as down.
 */
export async function probeBucket(config: S3StorageConfig, signal?: AbortSignal): Promise<void> {
  try {
    await s3Client(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: "health/probe" }),
      { abortSignal: signal },
    );
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 404) throw error;
  }
}

/** Deletes keys in batches of the S3 maximum (1000) per request. */
export async function deleteObjects(
  config: S3StorageConfig,
  keys: readonly string[],
): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    const result = await s3Client(config).send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    if (result.Errors?.length) {
      throw new Error(
        `Failed to delete ${result.Errors.length} object(s): ${result.Errors[0]?.Message}`,
      );
    }
  }
}

const TYPES = Object.fromEntries(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));

/**
 * Short-lived read URL. The response type is pinned from the key's (sniffed)
 * extension, so a changed object's metadata can't turn it into HTML, and PDFs
 * download instead of rendering on the bucket's origin.
 */
export async function signedGetUrl(config: S3StorageConfig, key: string, expiresIn = 60 * 10) {
  const ext = key.slice(key.lastIndexOf(".") + 1);
  const type = TYPES[ext] ?? "application/octet-stream";
  const inline = type.startsWith("image/");
  return getSignedUrl(
    s3Client(config),
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ResponseContentType: type,
      ResponseContentDisposition: inline
        ? "inline"
        : `attachment; filename="receipt.${TYPES[ext] ? ext : "bin"}"`,
    }),
    { expiresIn },
  );
}
