import fs from 'fs';
import fsPromises from 'fs/promises';
import mime from 'mime';
import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

import { getArtifactsDir, getArtifactMode } from '../../../common/artifacts';
import { getLatestUpdateBundlePathForRuntimeVersionAsync, getMetadataAsync } from '../../../common/helpers';

export default async function assets(req: NextApiRequest, res: NextApiResponse) {
  const slug = req.query.slug;
  if (!slug || typeof slug !== 'string') {
    res.status(400).json({ error: 'Missing app slug.' });
    return;
  }

  const { asset: assetName, runtimeVersion, platform } = req.query;

  if (!assetName || typeof assetName !== 'string') {
    res.status(400).json({ error: 'No asset name provided.' });
    return;
  }

  if (platform !== 'ios' && platform !== 'android') {
    res.status(400).json({ error: 'No platform provided. Expected "ios" or "android".' });
    return;
  }

  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.status(400).json({ error: 'No runtimeVersion provided.' });
    return;
  }

  const mode = getArtifactMode();
  if (mode === 'local' && getArtifactsDir()) {
    if (assetName.includes('..')) {
      res.status(400).json({ error: 'Invalid asset path.' });
      return;
    }

    const artifactsDir = getArtifactsDir()!;
    const assetPath = path.resolve(path.join(artifactsDir, assetName));
    if (!assetPath.startsWith(artifactsDir)) {
      res.status(400).json({ error: 'Invalid asset path.' });
      return;
    }

    // Ensure slug prefix is present (e.g. "<slug>/updates/...") to prevent cross-app reads.
    const normalized = assetName.replace(/^\/+/, '');
    if (!normalized.startsWith(`${slug}/`)) {
      res.status(403).json({ error: 'Asset does not belong to this app.' });
      return;
    }

    if (!fs.existsSync(assetPath)) {
      res.status(404).json({ error: `Asset "${assetName}" does not exist.` });
      return;
    }

    try {
      const asset = await fsPromises.readFile(assetPath, null);
      const ext = path.extname(assetPath).replace(/^\./, '');
      const contentType =
        ext === 'bundle' || ext === 'js' ? 'application/javascript' : mime.getType(ext);

      res.status(200);
      if (contentType) res.setHeader('content-type', contentType);
      res.end(asset);
    } catch (error) {
      console.log(error);
      res.status(500).json({ error });
    }
    return;
  }

  // Legacy PoC fallback (repo-local `updates/<runtimeVersion>/...`)
  let updateBundlePath: string;
  try {
    updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(runtimeVersion);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
    return;
  }

  const { metadataJson } = await getMetadataAsync({ updateBundlePath, runtimeVersion });
  const assetPath = path.resolve(assetName);
  const assetMetadata = metadataJson.fileMetadata[platform].assets.find(
    (asset: any) => asset.path === assetName.replace(`${updateBundlePath}/`, ''),
  );
  const isLaunchAsset =
    metadataJson.fileMetadata[platform].bundle === assetName.replace(`${updateBundlePath}/`, '');

  if (!fs.existsSync(assetPath)) {
    res.status(404).json({ error: `Asset "${assetName}" does not exist.` });
    return;
  }

  try {
    const asset = await fsPromises.readFile(assetPath, null);
    const contentType = isLaunchAsset ? 'application/javascript' : mime.getType(assetMetadata.ext);
    res.status(200);
    if (contentType) res.setHeader('content-type', contentType);
    res.end(asset);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error });
  }
}

