import fs from 'fs';
import fsPromises from 'fs/promises';
import mime from 'mime';
import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';

import { getArtifactsDir } from '../../../common/artifacts';

export default async function localFiles(req: NextApiRequest, res: NextApiResponse) {
  const root = getArtifactsDir();
  if (!root) {
    res.status(500).json({ error: 'ARTIFACTS_DIR is not configured.' });
    return;
  }

  const segments = req.query.path;
  const parts = Array.isArray(segments) ? segments : typeof segments === 'string' ? [segments] : [];
  if (!parts.length) {
    res.status(400).json({ error: 'Missing path.' });
    return;
  }

  const rel = parts.join('/');
  if (rel.includes('..')) {
    res.status(400).json({ error: 'Invalid path.' });
    return;
  }

  const filePath = path.resolve(path.join(root, rel));
  if (!filePath.startsWith(root)) {
    res.status(400).json({ error: 'Invalid path.' });
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found.' });
    return;
  }

  try {
    const data = await fsPromises.readFile(filePath);
    const ext = path.extname(filePath).replace(/^\./, '');
    const contentType =
      ext === 'bundle' || ext === 'js' ? 'application/javascript' : mime.getType(ext);
    if (contentType) {
      res.setHeader('content-type', contentType);
    }
    res.status(200).end(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to read file.' });
  }
}

