import { NextApiRequest, NextApiResponse } from 'next';

import { handleManifestForSlug } from './_shared/updates';

export default async function manifestEndpoint(req: NextApiRequest, res: NextApiResponse) {
  // Back-compat: if you still use `/api/manifest`, serve from a default slug.
  await handleManifestForSlug(req, res, process.env.DEFAULT_APP_SLUG ?? 'default');
}
