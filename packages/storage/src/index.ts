import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type S3StorageConfig = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

export type PutReceiptImageInput = {
  userId: string;
  receiptId: string;
  fileName: string;
  mimeType: string;
  body: Uint8Array;
};

export function createS3Client(config: S3StorageConfig) {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

export function receiptObjectKey(userId: string, receiptId: string, fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 96);
  return `users/${userId}/receipts/${receiptId}/${safeName}`;
}

export async function putReceiptImage(config: S3StorageConfig, input: PutReceiptImageInput) {
  const client = createS3Client(config);
  const key = receiptObjectKey(input.userId, input.receiptId, input.fileName);

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: input.body,
      ContentType: input.mimeType,
    }),
  );

  return { objectKey: key };
}

export async function getReceiptImageUrl(
  config: S3StorageConfig,
  objectKey: string,
  expiresIn = 60 * 10,
) {
  const client = createS3Client(config);
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    }),
    { expiresIn },
  );
}
