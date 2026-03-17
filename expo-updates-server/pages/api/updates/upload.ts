import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import formidable from 'formidable';
import type { NextApiRequest, NextApiResponse } from 'next';
import unzipper from 'unzipper';

import { getArtifactMode } from '../../../common/artifacts';
import { getS3Bucket, getS3Client } from '../../../common/s3';
import {
  computeFileInfo,
  putJsonToS3,
  s3LatestKey,
  s3UpdateInfoKey,
  s3UpdatePrefix,
} from '../../../common/s3Updates';
import {
  computeFileInfo as computeLocalFileInfo,
  localLatestPath,
  localUpdateDir,
  localUpdateInfoPath,
  putJsonToLocal,
} from '../../../common/localUpdates';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function parseMultipartFormAsync(req: NextApiRequest): Promise<{
  fields: Record<string, string>;
  fileBuffer: Buffer;
}> {
  const form = formidable({
    multiples: false,
    maxFileSize: 1024 * 1024 * 200, // 200MB
  });

  const { fields, files } = await new Promise<{
    fields: formidable.Fields;
    files: formidable.Files;
  }>((resolve, reject) => {
    form.parse(req, (err, f, fl) => {
      if (err) reject(err);
      else resolve({ fields: f, files: fl });
    });
  });

  const file = (files.file as formidable.File | formidable.File[] | undefined) ?? undefined;
  const firstFile = Array.isArray(file) ? file[0] : file;
  if (!firstFile?.filepath) {
    throw new Error('Missing file field "file".');
  }

  const buf = await fs.readFile(firstFile.filepath);
  const stringFields: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const first = Array.isArray(v) ? v[0] : v;
    if (typeof first === 'string') stringFields[k] = first;
  }

  return { fields: stringFields, fileBuffer: buf };
}

type UploadResponse =
  | {
      ok: true;
      slug: string;
      runtimeVersion: string;
      channel: string;
      platform: 'ios' | 'android';
      updateId: string;
      storage: 's3' | 'local';
      prefix: string;
      latestPointer: string;
    }
  | { ok: false; error: string };

export default async function uploadUpdate(req: NextApiRequest, res: NextApiResponse<UploadResponse>) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Expected POST.' });
    return;
  }

  const expected = process.env.UPLOAD_TOKEN;
  if (expected) {
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!token || token !== expected) {
      res.status(401).json({ ok: false, error: 'Unauthorized.' });
      return;
    }
  }

  let fields: Record<string, string>;
  let uploadBuf: Buffer;
  try {
    const parsed = await parseMultipartFormAsync(req);
    fields = parsed.fields;
    uploadBuf = parsed.fileBuffer;
  } catch (e: any) {
    res.status(400).json({ ok: false, error: e?.message ?? 'Invalid multipart body.' });
    return;
  }

  const slug = req.query.slug ?? fields.slug;
  if (!slug || typeof slug !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing slug.' });
    return;
  }
  if (!/^[a-z0-9][a-z0-9-_]*$/i.test(slug)) {
    res.status(400).json({ ok: false, error: 'Invalid slug.' });
    return;
  }

  const runtimeVersion = fields.runtimeVersion;
  const channel = fields.channel ?? 'default';
  const platform = fields.platform as any;

  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing runtimeVersion.' });
    return;
  }
  if (!channel || typeof channel !== 'string') {
    res.status(400).json({ ok: false, error: 'Missing channel.' });
    return;
  }
  if (platform !== 'ios' && platform !== 'android') {
    res.status(400).json({ ok: false, error: 'Missing/invalid platform. Expected ios or android.' });
    return;
  }

  const updateId = fields.updateId ? fields.updateId : crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const mode = getArtifactMode();

  // Unzip into memory; V1 assumes exports are reasonably sized.
  const directory = await unzipper.Open.buffer(uploadBuf);

  const fileInfoByPath: Record<
    string,
    { sha256Base64Url: string; md5Hex: string; contentType: string | null; size: number }
  > = {};

  let expoExportMetadata: any = null;
  let expoConfig: any = null;

  const normalizeEntryPath = (p: string) => p.replace(/^\/+/, '').replace(/\\/g, '/');

  if (mode === 's3') {
    const s3Prefix = s3UpdatePrefix(slug, runtimeVersion, channel, platform, updateId);
    const Bucket = getS3Bucket();
    const s3 = getS3Client();

    for (const entry of directory.files) {
      if (entry.type !== 'File') continue;

      const rawPath = normalizeEntryPath(entry.path);
      if (!rawPath) continue;

      // Accept either:
      // - dist/... (exported files)
      // - ... (exported files at root)
      const relPath = rawPath.startsWith('dist/') ? rawPath.slice('dist/'.length) : rawPath;
      if (!relPath || relPath.endsWith('/')) continue;

      const buf = await entry.buffer();

      if (relPath === 'metadata.json') {
        try {
          expoExportMetadata = JSON.parse(buf.toString('utf8'));
        } catch {}
      } else if (relPath === 'expoConfig.json') {
        try {
          expoConfig = JSON.parse(buf.toString('utf8'));
        } catch {}
      }

      // Upload every file (including metadata/config) for transparency + debugging.
      const Key = `${s3Prefix}/${relPath}`;
      const info = computeFileInfo(buf, relPath);
      fileInfoByPath[relPath] = info;

      await s3.send(
        new PutObjectCommand({
          Bucket,
          Key,
          Body: buf,
          ContentType: info.contentType ?? undefined,
          CacheControl: relPath.endsWith('.json') ? 'no-cache' : 'public, max-age=31536000, immutable',
        }),
      );
    }

    if (!expoExportMetadata || !expoExportMetadata.fileMetadata) {
      res
        .status(400)
        .json({ ok: false, error: 'Zip is missing a valid Expo export metadata.json.' });
      return;
    }
    if (!expoConfig) {
      res.status(400).json({ ok: false, error: 'Zip is missing expoConfig.json.' });
      return;
    }

    const updateInfo = {
      slug,
      runtimeVersion,
      channel,
      platform,
      updateId,
      createdAt,
      s3Prefix,
      expoConfig,
      expoExportMetadata,
      fileInfoByPath,
    };

    await putJsonToS3(s3UpdateInfoKey(s3Prefix), updateInfo);

    const latestKey = s3LatestKey(slug, runtimeVersion, channel, platform);
    await putJsonToS3(latestKey, {
      slug,
      runtimeVersion,
      channel,
      platform,
      updateId,
      createdAt,
      s3Prefix,
    });

    res.status(200).json({
      ok: true,
      slug,
      runtimeVersion,
      channel,
      platform,
      updateId,
      storage: 's3',
      prefix: s3Prefix,
      latestPointer: latestKey,
    });
    return;
  }

  // Local artifact mode (ARTIFACTS_DIR or repo-local)
  const { dir: updateDir, relativePrefix } = localUpdateDir(slug, runtimeVersion, channel, platform, updateId);
  await fs.mkdir(updateDir, { recursive: true });

  for (const entry of directory.files) {
    if (entry.type !== 'File') continue;

    const rawPath = normalizeEntryPath(entry.path);
    if (!rawPath) continue;

    const relPath = rawPath.startsWith('dist/') ? rawPath.slice('dist/'.length) : rawPath;
    if (!relPath || relPath.endsWith('/')) continue;

    const buf = await entry.buffer();

    if (relPath === 'metadata.json') {
      try {
        expoExportMetadata = JSON.parse(buf.toString('utf8'));
      } catch {}
    } else if (relPath === 'expoConfig.json') {
      try {
        expoConfig = JSON.parse(buf.toString('utf8'));
      } catch {}
    }

    const info = computeLocalFileInfo(buf, relPath);
    fileInfoByPath[relPath] = info;

    const outPath = path.join(updateDir, relPath);
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, buf);
  }

  if (!expoExportMetadata || !expoExportMetadata.fileMetadata) {
    res
      .status(400)
      .json({ ok: false, error: 'Zip is missing a valid Expo export metadata.json.' });
    return;
  }
  if (!expoConfig) {
    res.status(400).json({ ok: false, error: 'Zip is missing expoConfig.json.' });
    return;
  }

  const updateInfo = {
    slug,
    runtimeVersion,
    channel,
    platform,
    updateId,
    createdAt,
    relativePrefix,
    expoConfig,
    expoExportMetadata,
    fileInfoByPath,
  };

  await putJsonToLocal(localUpdateInfoPath(updateDir), updateInfo);
  const latestPath = localLatestPath(slug, runtimeVersion, channel, platform);
  await putJsonToLocal(latestPath, {
    slug,
    runtimeVersion,
    channel,
    platform,
    updateId,
    createdAt,
    relativePrefix,
  });

  res.status(200).json({
    ok: true,
    slug,
    runtimeVersion,
    channel,
    platform,
    updateId,
    storage: 'local',
    prefix: relativePrefix,
    latestPointer: latestPath,
  });
}

