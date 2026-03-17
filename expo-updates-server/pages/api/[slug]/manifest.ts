import type { NextApiRequest, NextApiResponse } from 'next';

import { handleManifestForSlug } from '../_shared/updates';

export default async function manifest(req: NextApiRequest, res: NextApiResponse) {
  const slug = req.query.slug;
  if (!slug || typeof slug !== 'string') {
    res.status(400).json({ error: 'Missing app slug.' });
    return;
  }
  await handleManifestForSlug(req, res, slug);
}

