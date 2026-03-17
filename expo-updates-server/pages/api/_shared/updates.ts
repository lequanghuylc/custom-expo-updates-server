import FormData from 'form-data';
import { NextApiRequest, NextApiResponse } from 'next';
import { serializeDictionary } from 'structured-headers';

import {
  convertToDictionaryItemsRepresentation,
  signRSASHA256,
  getPrivateKeyAsync,
  getLatestUpdateBundlePathForRuntimeVersionAsync,
  createRollBackDirectiveAsync,
  NoUpdateAvailableError,
  createNoUpdateAvailableDirectiveAsync,
  convertSHA256HashToUUID,
} from '../../../common/helpers';
import { getArtifactMode } from '../../../common/artifacts';
import { getLatestPointerFromS3, getUpdateInfoFromS3, s3PublicUrlForKey } from '../../../common/s3Updates';
import { getLatestPointerFromLocal, getUpdateInfoFromLocal } from '../../../common/localUpdates';

export async function handleManifestForSlug(req: NextApiRequest, res: NextApiResponse, slug: string) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'Expected GET.' });
    return;
  }

  const protocolVersionMaybeArray = req.headers['expo-protocol-version'];
  if (protocolVersionMaybeArray && Array.isArray(protocolVersionMaybeArray)) {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported protocol version. Expected either 0 or 1.',
    });
    return;
  }
  const protocolVersion = parseInt(protocolVersionMaybeArray ?? '0', 10);

  const platform = req.headers['expo-platform'] ?? req.query['platform'];
  if (platform !== 'ios' && platform !== 'android') {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported platform. Expected either ios or android.',
    });
    return;
  }

  const runtimeVersion = req.headers['expo-runtime-version'] ?? req.query['runtime-version'];
  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.statusCode = 400;
    res.json({
      error: 'No runtimeVersion provided.',
    });
    return;
  }

  const channel =
    (req.headers['expo-channel-name'] as string | undefined) ??
    (req.query['channel'] as string | undefined) ??
    'default';

  try {
    const mode = getArtifactMode();

    if (mode === 's3') {
      const pointer = await getLatestPointerFromS3(slug, runtimeVersion, channel, platform);
      const info = await getUpdateInfoFromS3(pointer.s3Prefix);
      await putUpdateInfoInResponseAsync(req, res, info, protocolVersion, {
        assetUrlForRelPath: (relPath) => s3PublicUrlForKey(`${info.s3Prefix}/${relPath}`),
      });
      return;
    }

    if (mode === 'local' && process.env.ARTIFACTS_DIR) {
      const pointer = await getLatestPointerFromLocal(slug, runtimeVersion, channel, platform);
      const info = await getUpdateInfoFromLocal(pointer.relativePrefix);
      const hostname = process.env.HOSTNAME;
      if (!hostname) throw new Error('Missing HOSTNAME');

      await putUpdateInfoInResponseAsync(req, res, info, protocolVersion, {
        assetUrlForRelPath: (relPath) =>
          `${hostname.replace(/\/+$/, '')}/api/local-files/${encodeURIComponent(
            `${info.relativePrefix}/${relPath}`,
          )}`,
      });
      return;
    }

    // Legacy PoC fallback (repo-local `updates/<runtimeVersion>/...`)
    const updateBundlePath = await getLatestUpdateBundlePathForRuntimeVersionAsync(runtimeVersion);
    const updateType = await (await import('fs/promises')).readdir(updateBundlePath).then((c) =>
      c.includes('rollback') ? 'rollback' : 'normal',
    );

    if (updateType === 'normal') {
      const { getAssetMetadataAsync, getMetadataAsync, getExpoConfigAsync } = await import(
        '../../../common/helpers'
      );
      const currentUpdateId = req.headers['expo-current-update-id'];
      const { metadataJson, createdAt, id } = await getMetadataAsync({ updateBundlePath, runtimeVersion });
      if (currentUpdateId === convertSHA256HashToUUID(id) && protocolVersion === 1) {
        throw new NoUpdateAvailableError();
      }
      const expoConfig = await getExpoConfigAsync({ updateBundlePath, runtimeVersion });
      const platformSpecificMetadata = metadataJson.fileMetadata[platform];
      const manifest = {
        id: convertSHA256HashToUUID(id),
        createdAt,
        runtimeVersion,
        assets: await Promise.all(
          (platformSpecificMetadata.assets as any[]).map((asset: any) =>
            getAssetMetadataAsync({
              updateBundlePath,
              filePath: asset.path,
              ext: asset.ext,
              runtimeVersion,
              platform,
              isLaunchAsset: false,
            }),
          ),
        ),
        launchAsset: await getAssetMetadataAsync({
          updateBundlePath,
          filePath: platformSpecificMetadata.bundle,
          isLaunchAsset: true,
          runtimeVersion,
          platform,
          ext: null,
        }),
        metadata: {},
        extra: {
          expoClient: expoConfig,
        },
      };
      await writeMultipartResponse(req, res, { manifest }, protocolVersion);
      return;
    }

    // rollback
    if (protocolVersion === 0) {
      throw new Error('Rollbacks not supported on protocol version 0');
    }
    const directive = await createRollBackDirectiveAsync(updateBundlePath);
    await writeMultipartResponse(req, res, { directive }, 1);
  } catch (e: any) {
    if (e instanceof NoUpdateAvailableError) {
      if (protocolVersion === 0) {
        res.statusCode = 404;
        res.json({ error: 'No updates available.' });
        return;
      }
      const directive = await createNoUpdateAvailableDirectiveAsync();
      await writeMultipartResponse(req, res, { directive }, 1);
      return;
    }
    res.statusCode = 404;
    res.json({ error: e?.message ?? String(e) });
  }
}

// Important: This is NOT an API route. Next.js `pages/api` treats all `.ts` files under
// `pages/api` as routes, so we provide a harmless default export to satisfy Next's typing.
export default function _sharedNotARoute() {
  return;
}

async function putUpdateInfoInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  updateInfo: any,
  protocolVersion: number,
  opts: { assetUrlForRelPath: (relPath: string) => string },
): Promise<void> {
  const currentUpdateId = req.headers['expo-current-update-id'];
  const runtimeVersion = updateInfo.runtimeVersion;
  const platform = updateInfo.platform as 'ios' | 'android';

  const manifestId = updateInfo.updateId;
  if (currentUpdateId === manifestId && protocolVersion === 1) {
    throw new NoUpdateAvailableError();
  }

  const metadataJson = updateInfo.expoExportMetadata;
  const platformSpecificMetadata = metadataJson.fileMetadata[platform];

  const assetFromRelPath = (relPath: string, ext: string | null, isLaunchAsset: boolean) => {
    const info = updateInfo.fileInfoByPath?.[relPath];
    if (!info) {
      throw new Error(`Missing file info for ${relPath}`);
    }

    const key = info.md5Hex;
    const keyExtensionSuffix = isLaunchAsset ? 'bundle' : ext;
    return {
      hash: info.sha256Base64Url,
      key,
      fileExtension: `.${keyExtensionSuffix}`,
      contentType: isLaunchAsset ? 'application/javascript' : info.contentType,
      url: opts.assetUrlForRelPath(relPath),
    };
  };

  const manifest = {
    id: manifestId,
    createdAt: updateInfo.createdAt,
    runtimeVersion,
    assets: await Promise.all(
      (platformSpecificMetadata.assets as any[]).map(async (asset: any) =>
        assetFromRelPath(asset.path, asset.ext, false),
      ),
    ),
    launchAsset: assetFromRelPath(platformSpecificMetadata.bundle, null, true),
    metadata: {},
    extra: {
      expoClient: updateInfo.expoConfig,
    },
  };

  await writeMultipartResponse(req, res, { manifest }, protocolVersion);
}

async function writeMultipartResponse(
  req: NextApiRequest,
  res: NextApiResponse,
  body: { manifest?: any; directive?: any },
  protocolVersion: number,
) {
  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  const payload = body.manifest ?? body.directive;

  if (expectSignatureHeader) {
    const privateKey = await getPrivateKeyAsync();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const payloadString = JSON.stringify(payload);
    const hashSignature = signRSASHA256(payloadString, privateKey);
    const dictionary = convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const assetRequestHeaders: { [key: string]: object } = {};
  if (body.manifest) {
    [...body.manifest.assets, body.manifest.launchAsset].forEach((asset: any) => {
      assetRequestHeaders[asset.key] = {
        'test-header': 'test-header-value',
      };
    });
  }

  const form = new FormData();

  if (body.manifest) {
    form.append('manifest', JSON.stringify(body.manifest), {
      contentType: 'application/json',
      header: {
        'content-type': 'application/json; charset=utf-8',
        ...(signature ? { 'expo-signature': signature } : {}),
      },
    });
    form.append('extensions', JSON.stringify({ assetRequestHeaders }), { contentType: 'application/json' });
  } else if (body.directive) {
    form.append('directive', JSON.stringify(body.directive), {
      contentType: 'application/json',
      header: {
        'content-type': 'application/json; charset=utf-8',
        ...(signature ? { 'expo-signature': signature } : {}),
      },
    });
  }

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', protocolVersion);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();
}

