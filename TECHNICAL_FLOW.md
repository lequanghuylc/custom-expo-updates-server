# Technical Flow

This document explains how the app and server interact for OTA updates, and where to look in code when debugging.

## High-level architecture

- `expo-updates-client` builds and uploads update artifacts.
- `expo-updates-server` stores artifacts (local disk or S3), serves manifests, and serves assets.
- App runtime (`expo-updates`) calls the manifest endpoint, then downloads assets listed in the manifest.

## Main runtime actors

- App: `expo-updates-client`
- Server: `expo-updates-server`
- Storage mode:
  - `ARTIFACT_MODE=local` (disk via `ARTIFACTS_DIR`)
  - `ARTIFACT_MODE=s3` (S3 via `S3_BUCKET`, `S3_REGION`, `S3_PUBLIC_BASE_URL`)

## App -> Server publish flow

1. Run publish script in app repo:
   - `expo-updates-client/scripts/push.sh`
2. Script actions:
   - Runs `npx expo export`
   - Writes `dist/expoConfig.json` from `app.json`
   - Zips exported output
   - Uploads zip twice:
     - once with `platform=ios`
     - once with `platform=android`
3. Upload endpoint:
   - `POST /api/<slug>/updates/upload`
   - `slug` comes from `expo.slug` in `app.json`

### Upload API contract

- Endpoint: `POST /api/<slug>/updates/upload`
- Auth: `Authorization: Bearer <UPLOAD_TOKEN>` (if `UPLOAD_TOKEN` configured)
- Multipart fields:
  - `runtimeVersion` (required)
  - `channel` (optional; default `default`)
  - `platform` (`ios|android`, required)
  - `updateId` (optional)
  - `file` (zip, required)
  - `slug` (sent by script as extra safety; route param is authoritative)

## Server storage layout

### Local mode (`ARTIFACT_MODE=local`)

Root: `ARTIFACTS_DIR`

- Update files:
  - `<ARTIFACTS_DIR>/<slug>/updates/<runtimeVersion>/<channel>/<platform>/<updateId>/...`
- Pointer:
  - `<ARTIFACTS_DIR>/<slug>/updates/<runtimeVersion>/<channel>/<platform>/latest.json`
- Update metadata:
  - `.../<updateId>/update-info.json`

### S3 mode (`ARTIFACT_MODE=s3`)

- Update files:
  - `<slug>/updates/<runtimeVersion>/<channel>/<platform>/<updateId>/...`
- Pointer:
  - `<slug>/updates/<runtimeVersion>/<channel>/<platform>/latest.json`
- Update metadata:
  - `.../<updateId>/update-info.json`

## App runtime update fetch flow

1. App requests manifest:
   - `GET /api/<slug>/manifest`
   - `updates.url` in app config should point here.
2. Server resolves latest update using:
   - `slug + runtimeVersion + channel + platform`
3. Server returns multipart manifest (`content-type: multipart/mixed`) with:
   - `manifest` part
   - `extensions` part
4. App downloads `launchAsset` and `assets[]` URLs from manifest.
5. App applies update once required assets are downloaded.

## Channel/runtime/platform matching

Manifest selection keys:

- `slug`: from route param (`/api/<slug>/manifest`)
- `runtimeVersion`: from request header `expo-runtime-version`
- `platform`: from request header `expo-platform`
- `channel`: from header `expo-channel-name`, or query `?channel=...`, else `default`

If these do not match what was uploaded, server returns 404/missing pointer.

## Endpoints map

Primary (multi-app):

- `GET /api/<slug>/manifest`
- `GET /api/<slug>/assets` (legacy-style asset handler)
- `POST /api/<slug>/updates/upload`

Local static file serving:

- `GET /api/local-files/<path...>` (serves from `ARTIFACTS_DIR`)

Back-compat:

- `GET /api/manifest` (uses `DEFAULT_APP_SLUG` or `default`)
- `GET /api/assets`
- `POST /api/updates/upload`

## File map (where to look)

Server:

- Route entrypoints:
  - `expo-updates-server/pages/api/[slug]/manifest.ts`
  - `expo-updates-server/pages/api/[slug]/updates/upload.ts`
  - `expo-updates-server/pages/api/[slug]/assets.ts`
  - `expo-updates-server/pages/api/local-files/[...path].ts`
- Shared manifest logic:
  - `expo-updates-server/pages/api/_shared/updates.ts`
- Storage helpers:
  - `expo-updates-server/common/artifacts.ts`
  - `expo-updates-server/common/localUpdates.ts`
  - `expo-updates-server/common/s3Updates.ts`
  - `expo-updates-server/common/publicBaseUrl.ts`

App:

- Publish script:
  - `expo-updates-client/scripts/push.sh`
- Client update config:
  - `expo-updates-client/app.json` (`expo.slug`, `expo.runtimeVersion`, `expo.updates.url`)

## Common failure patterns

- Relative/bad asset URLs:
  - Set `PUBLIC_BASE_URL` (do not rely on `HOSTNAME` in production).
- Manifest 404 for latest pointer:
  - Channel mismatch (`production` vs `main` vs `default`) or wrong runtimeVersion/platform.
- "Failed to load all assets":
  - Manifest resolved, but one or more asset URLs are wrong or files missing in storage.
- Unauthorized upload:
  - Missing/incorrect `Authorization: Bearer <UPLOAD_TOKEN>`.

