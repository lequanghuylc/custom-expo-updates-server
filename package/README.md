# expo-updates-custom

CLI to configure and publish OTA updates to a custom Expo updates server.

Please note this is a selfhosted Expo update solutions, you need to have the server up and running. For more details, visit the [Github repo](https://github.com/lequanghuylc/custom-expo-updates-server)

## Commands

- Install:
  - `npm install expo-updates-custom`
  - or `yarn add expo-updates-custom`

- `npx expo-updates-custom init`
  - Prompts for server domain, slug, channel, and upload token
  - Updates `app.json` under `expo.updates`
  - Sets `expo.updates.codeSigningCertificate` to `./node_modules/expo-updates-custom/code-signing/certificate.pem`
  - Removes `expo.extra.eas` (if present)
  - Stores push token at `expo.extra.expoUpdatesCustom.pushToken`
  - Prints applied changes and reminds you to run `npx expo prebuild`

- `npx expo-updates-custom push`
  - Runs `npx expo export`
  - Writes `dist/expoConfig.json`
  - Zips the export
  - Uploads update zip to iOS and Android upload endpoints
  - Uses token/channel from `app.json`

- `npx expo-updates-custom codesign`
  - Generates `code-signing/private-key.pem` and `code-signing/certificate.pem` in your app repo
  - Copy `private-key.pem` into your server repo and set `PRIVATE_KEY_PATH` there
