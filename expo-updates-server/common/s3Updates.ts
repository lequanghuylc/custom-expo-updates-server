import crypto from 'crypto';
import mime from 'mime';
import path from 'path';
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { getS3Bucket, getS3Client, getS3PublicBaseUrl } from './s3';

export type UpdatePointer = {
  slug: string;
  runtimeVersion: string;
  channel: string;
  platform: 'ios' | 'android';
  updateId: string;
  createdAt: string;
  s3Prefix: string;
};

export type UpdateInfo = {
  slug: string;
  runtimeVersion: string;
  channel: string;
  platform: 'ios' | 'android';
  updateId: string;
  createdAt: string;
  s3Prefix: string;
  expoConfig: any;
  expoExportMetadata: any;
  fileInfoByPath: Record<
    string,
    {
      sha256Base64Url: string;
      md5Hex: string;
      contentType: string | null;
      size: number;
    }
  >;
};

export function s3LatestKey(
  slug: string,
  runtimeVersion: string,
  channel: string,
  platform: string,
): string {
  return `${encodeURIComponent(slug)}/updates/${encodeURIComponent(runtimeVersion)}/${encodeURIComponent(
    channel,
  )}/${platform}/latest.json`;
}

export function s3UpdatePrefix(
  slug: string,
  runtimeVersion: string,
  channel: string,
  platform: string,
  updateId: string,
): string {
  return `${encodeURIComponent(slug)}/updates/${encodeURIComponent(runtimeVersion)}/${encodeURIComponent(
    channel,
  )}/${platform}/${updateId}`;
}

export function s3UpdateInfoKey(s3Prefix: string): string {
  return `${s3Prefix}/update-info.json`;
}

export function s3PublicUrlForKey(key: string): string {
  const base = getS3PublicBaseUrl();
  return `${base}/${key.replace(/^\/+/, '')}`;
}

async function streamToString(body: any): Promise<string> {
  if (!body) throw new Error('Missing S3 body');
  if (typeof body.transformToString === 'function') {
    return await body.transformToString();
  }
  // Node.js Readable stream fallback
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function getLatestPointerFromS3(
  slug: string,
  runtimeVersion: string,
  channel: string,
  platform: 'ios' | 'android',
): Promise<UpdatePointer> {
  const s3 = getS3Client();
  const Bucket = getS3Bucket();
  const Key = s3LatestKey(slug, runtimeVersion, channel, platform);

  const resp = await s3.send(new GetObjectCommand({ Bucket, Key }));
  const text = await streamToString(resp.Body);
  const json = JSON.parse(text);

  if (!json?.s3Prefix || !json?.updateId) {
    throw new Error('Invalid latest.json');
  }
  return json as UpdatePointer;
}

export async function getUpdateInfoFromS3(s3Prefix: string): Promise<UpdateInfo> {
  const s3 = getS3Client();
  const Bucket = getS3Bucket();
  const Key = s3UpdateInfoKey(s3Prefix);

  const resp = await s3.send(new GetObjectCommand({ Bucket, Key }));
  const text = await streamToString(resp.Body);
  return JSON.parse(text) as UpdateInfo;
}

export function computeFileInfo(buf: Buffer, filePath: string) {
  const sha256 = crypto.createHash('sha256').update(buf).digest('base64');
  const sha256Base64Url = sha256.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const md5Hex = crypto.createHash('md5').update(buf).digest('hex');
  const ext = path.extname(filePath).replace(/^\./, '');
  const contentType =
    ext === 'bundle' || ext === 'js' ? 'application/javascript' : (mime.getType(ext) as string | null);

  return {
    sha256Base64Url,
    md5Hex,
    contentType,
    size: buf.length,
  };
}

export async function putJsonToS3(Key: string, obj: unknown): Promise<void> {
  const s3 = getS3Client();
  const Bucket = getS3Bucket();
  const Body = JSON.stringify(obj);
  await s3.send(
    new PutObjectCommand({
      Bucket,
      Key,
      Body,
      ContentType: 'application/json; charset=utf-8',
      CacheControl: 'no-cache',
    }),
  );
}

