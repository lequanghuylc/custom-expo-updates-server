import { S3Client } from '@aws-sdk/client-s3';

let cachedClient: S3Client | null = null;

export function getS3Client(): S3Client {
  if (cachedClient) return cachedClient;

  const region = process.env.S3_REGION;
  if (!region) {
    throw new Error('Missing S3_REGION');
  }

  cachedClient = new S3Client({
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

  return cachedClient;
}

export function getS3Bucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('Missing S3_BUCKET');
  }
  return bucket;
}

export function getS3PublicBaseUrl(): string {
  const baseUrl = process.env.S3_PUBLIC_BASE_URL;
  if (!baseUrl) {
    throw new Error('Missing S3_PUBLIC_BASE_URL');
  }
  return baseUrl.replace(/\/+$/, '');
}

