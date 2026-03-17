import crypto from 'crypto';
import fs from 'fs/promises';
import mime from 'mime';
import path from 'path';

import { getLocalArtifactsRoot } from './artifacts';

export type LocalUpdatePointer = {
  slug: string;
  runtimeVersion: string;
  channel: string;
  platform: 'ios' | 'android';
  updateId: string;
  createdAt: string;
  relativePrefix: string; // <slug>/updates/<runtime>/<channel>/<platform>/<updateId>
};

export type LocalUpdateInfo = {
  slug: string;
  runtimeVersion: string;
  channel: string;
  platform: 'ios' | 'android';
  updateId: string;
  createdAt: string;
  relativePrefix: string;
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

export function localLatestPath(
  slug: string,
  runtimeVersion: string,
  channel: string,
  platform: string,
): string {
  const root = getLocalArtifactsRoot();
  return path.join(root, slug, 'updates', runtimeVersion, channel, platform, 'latest.json');
}

export function localUpdateDir(
  slug: string,
  runtimeVersion: string,
  channel: string,
  platform: string,
  updateId: string,
): { dir: string; relativePrefix: string } {
  const root = getLocalArtifactsRoot();
  const relativePrefix = path.posix.join(slug, 'updates', runtimeVersion, channel, platform, updateId);
  const dir = path.join(root, slug, 'updates', runtimeVersion, channel, platform, updateId);
  return { dir, relativePrefix };
}

export function localUpdateInfoPath(updateDir: string): string {
  return path.join(updateDir, 'update-info.json');
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

export async function putJsonToLocal(filePath: string, obj: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(obj), 'utf8');
}

export async function getLatestPointerFromLocal(
  slug: string,
  runtimeVersion: string,
  channel: string,
  platform: 'ios' | 'android',
): Promise<LocalUpdatePointer> {
  const p = localLatestPath(slug, runtimeVersion, channel, platform);
  const text = await fs.readFile(p, 'utf8');
  return JSON.parse(text) as LocalUpdatePointer;
}

export async function getUpdateInfoFromLocal(relativePrefix: string): Promise<LocalUpdateInfo> {
  const root = getLocalArtifactsRoot();
  const updateDir = path.join(root, relativePrefix);
  const text = await fs.readFile(localUpdateInfoPath(updateDir), 'utf8');
  return JSON.parse(text) as LocalUpdateInfo;
}

