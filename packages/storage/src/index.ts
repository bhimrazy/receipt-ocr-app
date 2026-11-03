import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type S3StorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

const clients = new Map<string, S3Client>();

/** One client per config, so keep-alive connections and TLS sessions are reused. */
export function s3Client(config: S3StorageConfig): S3Client {
  const key = JSON.stringify([
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

export async function signedGetUrl(config: S3StorageConfig, key: string, expiresIn = 60 * 10) {
  return getSignedUrl(s3Client(config), new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
    expiresIn,
  });
}
