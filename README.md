# Custom Expo Updates Server & Client

This repo contains a server and client that implement the [Expo Updates protocol specification](https://docs.expo.dev/technical-specs/expo-updates-0).

> [!IMPORTANT]
> This repo exists to provide a basic demonstration of how the protocol might be translated to code. It is not guaranteed to be complete, stable, or performant enough to use as a full-fledged backend for expo-updates. Expo does not provide hands-on technical support for custom expo-updates server implementations, including what is in this repo. Issues within the expo-updates client library itself (independent of server) may be reported at https://github.com/expo/expo/issues/new/choose. Any pull requests that add new features to this repository will likely be closed; instead, feel free to fork the repository to add new features.

## Why

Expo provides a set of service named EAS (Expo Application Services), one of which is EAS Update which can host and serve updates for an Expo app using the [`expo-updates`](https://github.com/expo/expo/tree/main/packages/expo-updates) library.

In some cases more control of how updates are sent to an app may be needed, and one option is to implement a custom updates server that adheres to the specification in order to serve update manifests and assets. This repo contains an example server implementation of the specification and a client app configured to use the example server.

## Getting started

### Updates overview

To understand this repo, it's important to understand some terminology around updates:

- **Runtime version**: Type: String. Runtime version specifies the version of the underlying native code your app is running. You'll want to update the runtime version of an update when it relies on new or changed native code, like when you update the Expo SDK, or add in any native modules into your apps. Failing to update an update's runtime version will cause your end-user's app to crash if the update relies on native code the end-user is not running.
- **Platform**: Type: "ios" or "android". Specifies which platform to to provide an update.
- **Manifest**: Described in the protocol. The manifest is an object that describes assets and other details that an Expo app needs to know to load an update.

### How the `expo-update-server` works

The flow for creating an update is as follows:

1. Configure and build a "release" version of an app, then run it on a simulator or deploy to an app store.
2. Run the project locally, make changes, then export the app as an update.
3. In the server repo, we'll copy the update made in #2 to the **expo-update-server/updates** directory, under a corresponding runtime version sub-directory.
4. In the "release" app, force close and reopen the app to make a request for an update from the custom update server. The server will return a manifest that matches the requests platform and runtime version.
5. Once the "release" app receives the manifest, it will then make requests for each asset, which will also be served from this server.
6. Once the app has all the required assets it needs from the server, it will load the update.

## The setup

Note: The app is configured to load updates from the server running at http://localhost:3000. If you prefer to load them from a different base URL (for example, in an Android emulator):
1. Update `.env.local` in the server.
2. Update `updates.url` in `app.json` and re-run the build steps below.

### Multiple apps (multi-tenant by slug)

This server can host updates for multiple apps. Each app is identified by its Expo **`slug`** and uses these endpoints:

- **Manifest**: `/api/<slug>/manifest`
- **Assets (local mode)**: `/api/<slug>/assets`
- **Upload**: `/api/<slug>/updates/upload`

Artifacts are stored under a slug folder:

- **S3 mode**: `<slug>/updates/<runtimeVersion>/<channel>/<platform>/<updateId>/...`
- **Local mode**: `$ARTIFACTS_DIR/<slug>/updates/<runtimeVersion>/<channel>/<platform>/<updateId>/...`

### Server environment variables

Copy `expo-updates-server/.env.sample` to `expo-updates-server/.env.local`.

- **Mode selector**
  - **`ARTIFACT_MODE=local`**: store updates on disk (recommended for single instance with a mounted volume)
  - **`ARTIFACT_MODE=s3`**: store updates in S3 and serve assets via `S3_PUBLIC_BASE_URL`

- **Local artifact mode**
  - **`PUBLIC_BASE_URL`**: base URL used to construct asset URLs (served from `GET /api/local-files/...`)
  - **`ARTIFACTS_DIR`**: root directory for artifacts (e.g. `/var/lib/expo-updates` mounted as a volume)

- **S3 artifact mode**
  - **`S3_BUCKET`**, **`S3_REGION`**, **`S3_PUBLIC_BASE_URL`**
  - **`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`** only if not using instance role / injected credentials

- **Publishing auth (recommended for both modes)**
  - **`UPLOAD_TOKEN`**: required by `POST /api/updates/upload` as `Authorization: Bearer <token>`

- **Code signing (optional)**
  - **`PRIVATE_KEY_PATH`**: enables signing manifests/directives

### Create a "release" app

The example Expo project configured for the server is located in **/expo-updates-client**.

#### iOS

Run `yarn` and `yarn ios --configuration Release`.

#### Android

Run `yarn` and then run `yarn android --variant release`.

### Make a change

Let's make a change to the project in /expo-updates-client that we'll want to push as an over-the-air update from our custom server to the "release" app. `cd` in to **/expo-updates-client**, then make a change in **App.js**.

Once you've made a change you're happy with, inside of **/expo-updates-server**, run `yarn expo-publish`. Under the hood, this script runs `npx expo export` in the client, copies the exported app to the server, and then copies the Expo config to the server as well.

### Publish an update (S3 V1 flow)

The S3-based V1 flow does **not** copy `dist/` into the server repo. Instead the app repo zips the export and uploads it to the server.

1. Configure the client app:
   - Set `expo.updates.url` in `expo-updates-client/app.json` to your server manifest endpoint (e.g. `https://your-server.com/api/<slug>/manifest`)
   - Ensure `expo.runtimeVersion` matches your native build’s runtime version
2. Configure the server (S3 mode) and run it.
3. From `expo-updates-client/`, run:
   - `./scripts/push.sh --token "$UPLOAD_TOKEN" --channel main`

This script will derive the server origin from `expo.updates.url` and upload updates for both iOS and Android.

### Publish an update (local artifact V1 flow)

This flow is the same as S3 publishing from the app repo, but the server stores artifacts on disk at `ARTIFACTS_DIR` and serves assets from `GET /api/assets`.

1. Set in the server env:
   - `ARTIFACT_MODE=local`
   - `ARTIFACTS_DIR=/your/mounted/volume/path`
   - `PUBLIC_BASE_URL=https://your-server.com`
2. Start the server.
3. From `expo-updates-client/`, run:
   - `./scripts/push.sh --token "$UPLOAD_TOKEN" --channel main`

### Send an update

Now we're ready to run the update server. Run `yarn dev` in the server folder of this repo to start the server.

In the simulator running the "release" version of the app, force close the app and re-open it. It should make a request to /api/manifest, then requests to /api/assets. After the app loads, it should show any changes you made locally.

### How the server selects the correct update (S3 V1)

The app requests `GET /api/manifest` with headers including:

- `expo-platform`: `ios` or `android`
- `expo-runtime-version`: your app’s `runtimeVersion`
- `expo-channel-name`: the channel (defaults to `default` if not supplied)

The server uses those values to load a pointer file in S3:

- `updates/<runtimeVersion>/<channel>/<platform>/latest.json`

That pointer references the specific uploaded update under:

- `updates/<runtimeVersion>/<channel>/<platform>/<updateId>/...`

The manifest returned by the server contains asset URLs that point directly to S3 (`S3_PUBLIC_BASE_URL`).

## About this server

This server was created with NextJS. You can find the API endpoints in **pages/api/manifest.js** and **pages/api/assets.js**.

The code signing keys and certificates were generated using https://github.com/expo/code-signing-certificates.
