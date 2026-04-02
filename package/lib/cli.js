/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const { randomUUID } = require('crypto');

function usage() {
  console.log(`expo-updates-custom

Usage:
  expo-updates-custom init
  expo-updates-custom push
  expo-updates-custom codesign
`);
}

function getAppJsonPath() {
  return path.join(process.cwd(), 'app.json');
}

function readAppJson() {
  const appJsonPath = getAppJsonPath();
  if (!fs.existsSync(appJsonPath)) {
    throw new Error(`app.json not found at ${appJsonPath}`);
  }
  const raw = fs.readFileSync(appJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.expo || typeof parsed.expo !== 'object') {
    throw new Error('Invalid app.json: missing "expo" object');
  }
  return { appJsonPath, parsed };
}

function writeAppJson(appJsonPath, value) {
  fs.writeFileSync(appJsonPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createAsk() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) =>
    new Promise((resolve) => {
      rl.question(question, (answer) => resolve(answer.trim()));
    });

  return {
    ask,
    close() {
      rl.close();
    },
  };
}

function toServerOrigin(serverInput) {
  const normalized = serverInput.startsWith('http://') || serverInput.startsWith('https://')
    ? serverInput
    : `https://${serverInput}`;
  const url = new URL(normalized);
  return url.origin;
}

function printAppJsonChanges(before, after) {
  console.log('\napp.json changes:');
  console.log(`- expo.updates.url: ${before.url || '(not set)'} -> ${after.url}`);
  console.log(`- expo.updates.enabled: ${before.enabled || false} -> true`);
  console.log(
    `- expo.updates.codeSigningCertificate: ${before.codeSigningCertificate || '(not set)'} -> ${after.codeSigningCertificate}`
  );
  console.log(
    `- expo.updates.fallbackToCacheTimeout: ${before.fallbackToCacheTimeout || '(not set)'} -> 30000`
  );
  console.log(
    `- expo.updates.requestHeaders["expo-channel-name"]: ${before.channel || '(not set)'} -> ${after.channel}`
  );
  console.log(
    `- expo.updates.codeSigningMetadata: ${before.codeSigningMetadata || '(not set)'} -> ${after.codeSigningMetadata}`
  );
  console.log(
    `- expo.extra.expoUpdatesCustom.pushToken: ${before.pushToken || '(not set)'} -> ${after.pushToken}`
  );
  console.log('- removed expo.extra.eas (if it existed)');
}

async function runInit() {
  const { appJsonPath, parsed } = readAppJson();
  const askCtx = createAsk();

  try {
    const expo = parsed.expo;
    const currentUrl = expo.updates && typeof expo.updates === 'object' ? expo.updates.url : '';
    const currentSlug = expo.slug ? String(expo.slug) : '';
    const currentChannel =
      expo.updates &&
      typeof expo.updates === 'object' &&
      expo.updates.requestHeaders &&
      typeof expo.updates.requestHeaders === 'object' &&
      expo.updates.requestHeaders['expo-channel-name']
        ? String(expo.updates.requestHeaders['expo-channel-name'])
        : 'default';
    const currentToken =
      expo.extra &&
      typeof expo.extra === 'object' &&
      expo.extra.expoUpdatesCustom &&
      typeof expo.extra.expoUpdatesCustom === 'object' &&
      expo.extra.expoUpdatesCustom.pushToken
        ? String(expo.extra.expoUpdatesCustom.pushToken)
        : '';

    console.log('Initialize custom Expo updates config\n');
    const serverInput = await askCtx.ask(
      `Server domain/origin [${currentUrl ? new URL(currentUrl).origin : 'http://localhost:3000'}]: `
    );
    const slugInput = await askCtx.ask(`App slug [${currentSlug || 'my-app'}]: `);
    const channelInput = await askCtx.ask(`Update channel [${currentChannel || 'default'}]: `);
    const tokenInput = await askCtx.ask(
      `Upload token (saved to app.json) [${currentToken || 'required'}]: `
    );

    const beforeValues = {
      url: currentUrl,
      enabled: expo.updates && typeof expo.updates === 'object' ? expo.updates.enabled : false,
      codeSigningCertificate:
        expo.updates && typeof expo.updates === 'object' ? expo.updates.codeSigningCertificate : undefined,
      codeSigningMetadata:
        expo.updates &&
        typeof expo.updates === 'object' &&
        expo.updates.codeSigningMetadata &&
        typeof expo.updates.codeSigningMetadata === 'object'
          ? JSON.stringify(expo.updates.codeSigningMetadata)
          : undefined,
      fallbackToCacheTimeout:
        expo.updates && typeof expo.updates === 'object' ? expo.updates.fallbackToCacheTimeout : undefined,
      channel: currentChannel,
      pushToken: currentToken,
    };

    const serverOrigin = toServerOrigin(
      serverInput || (currentUrl ? new URL(currentUrl).origin : 'http://localhost:3000')
    );
    const slug = slugInput || currentSlug || 'my-app';
    const channel = channelInput || currentChannel || 'default';
    const pushToken = tokenInput || currentToken;
    if (!pushToken) {
      throw new Error('Upload token is required.');
    }

    expo.slug = slug;
    expo.updates = {
      ...(expo.updates && typeof expo.updates === 'object' ? expo.updates : {}),
      url: `${serverOrigin}/api/${slug}/manifest`,
      enabled: true,
      codeSigningCertificate: './node_modules/expo-updates-custom/code-signing/certificate.pem',
      codeSigningMetadata: {
        keyid: 'main',
        alg: 'rsa-v1_5-sha256',
      },
      fallbackToCacheTimeout: 30000,
      requestHeaders: {
        ...((expo.updates &&
          typeof expo.updates === 'object' &&
          expo.updates.requestHeaders &&
          typeof expo.updates.requestHeaders === 'object'
          ? expo.updates.requestHeaders
          : {})),
        'expo-channel-name': channel,
      },
    };

    const extra = expo.extra && typeof expo.extra === 'object' ? { ...expo.extra } : {};
    delete extra.eas;
    extra.expoUpdatesCustom = {
      ...(extra.expoUpdatesCustom && typeof extra.expoUpdatesCustom === 'object'
        ? extra.expoUpdatesCustom
        : {}),
      pushToken,
    };
    expo.extra = extra;

    writeAppJson(appJsonPath, parsed);

    printAppJsonChanges(beforeValues, {
      url: `${serverOrigin}/api/${slug}/manifest`,
      codeSigningCertificate: './node_modules/expo-updates-custom/code-signing/certificate.pem',
      codeSigningMetadata: '{"keyid":"main","alg":"rsa-v1_5-sha256"}',
      channel,
      pushToken,
    });

    console.log('\nDone. Run `npx expo prebuild` to apply native config changes.');
  } finally {
    askCtx.close();
  }
}

function runCmd(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function readPushConfig(expo) {
  const token =
    expo.extra &&
    typeof expo.extra === 'object' &&
    expo.extra.expoUpdatesCustom &&
    typeof expo.extra.expoUpdatesCustom === 'object' &&
    expo.extra.expoUpdatesCustom.pushToken
      ? String(expo.extra.expoUpdatesCustom.pushToken)
      : '';
  const channel =
    expo.updates &&
    typeof expo.updates === 'object' &&
    expo.updates.requestHeaders &&
    typeof expo.updates.requestHeaders === 'object' &&
    expo.updates.requestHeaders['expo-channel-name']
      ? String(expo.updates.requestHeaders['expo-channel-name'])
      : 'default';
  const runtimeVersion = expo.runtimeVersion ? String(expo.runtimeVersion) : '';
  const slug = expo.slug ? String(expo.slug) : '';
  const updatesUrl =
    expo.updates && typeof expo.updates === 'object' && expo.updates.url ? String(expo.updates.url) : '';
  return { token, channel, runtimeVersion, slug, updatesUrl };
}

function runPush() {
  const { parsed } = readAppJson();
  const expo = parsed.expo;
  const { token, channel, runtimeVersion, slug, updatesUrl } = readPushConfig(expo);

  if (!token) {
    throw new Error('Missing expo.extra.expoUpdatesCustom.pushToken in app.json');
  }
  if (!slug) {
    throw new Error('Missing expo.slug in app.json');
  }
  if (!runtimeVersion) {
    throw new Error('Missing expo.runtimeVersion in app.json');
  }
  if (!updatesUrl) {
    throw new Error('Missing expo.updates.url in app.json');
  }

  const serverOrigin = new URL(updatesUrl).origin;
  const uploadUrl = `${serverOrigin.replace(/\/$/, '')}/api/${slug}/updates/upload`;
  const updateId = randomUUID();
  const stamp = Date.now();
  const zipName = `update-${channel}-${runtimeVersion}-${stamp}.zip`;

  console.log('Building export...');
  runCmd('npx expo export');

  console.log('Writing dist/expoConfig.json...');
  fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'dist', 'expoConfig.json'), JSON.stringify(expo), 'utf8');

  console.log(`Creating zip ${zipName}...`);
  if (fs.existsSync(path.join(process.cwd(), zipName))) {
    fs.unlinkSync(path.join(process.cwd(), zipName));
  }
  runCmd(`cd dist && zip -qr "../${zipName}" .`);

  const escapedToken = token.replace(/"/g, '\\"');
  const commonCurl = [
    'curl -sS',
    `-X POST "${uploadUrl}"`,
    `-H "Authorization: Bearer ${escapedToken}"`,
    `-F "slug=${slug}"`,
    `-F "runtimeVersion=${runtimeVersion}"`,
    `-F "channel=${channel}"`,
    `-F "updateId=${updateId}"`,
    `-F "file=@${zipName};type=application/zip"`,
  ].join(' ');

  console.log('Uploading iOS update...');
  runCmd(`${commonCurl} -F "platform=ios"`);
  console.log('Uploading Android update...');
  runCmd(`${commonCurl} -F "platform=android"`);

  console.log(`Cleaning up zip ${zipName}...`);
  fs.unlinkSync(path.join(process.cwd(), zipName));
  console.log('Done.');
}

function runCodesign() {
  const dir = path.join(process.cwd(), 'code-signing');
  fs.mkdirSync(dir, { recursive: true });
  const privateKeyPath = path.join(dir, 'private-key.pem');
  const certificatePath = path.join(dir, 'certificate.pem');

  console.log('Generating RSA private key...');
  runCmd(`openssl genrsa -out "${privateKeyPath}" 2048`);

  console.log('Generating self-signed certificate...');
  runCmd(
    `openssl req -new -x509 -sha256 -key "${privateKeyPath}" -out "${certificatePath}" -days 36500 -subj "/CN=expo-updates-custom"`
  );

  console.log('\nCode signing files created:');
  console.log(`- ${privateKeyPath}`);
  console.log(`- ${certificatePath}`);
  console.log('\nNext steps:');
  console.log('- Keep private-key.pem in your server repo (or secure secret storage).');
  console.log('- Set server env PRIVATE_KEY_PATH to that private key path.');
  console.log('- Keep certificate.pem in your app repo and ensure app.json points to it.');
}

async function run(argv) {
  const command = argv[2];
  if (!command || command === '--help' || command === '-h') {
    usage();
    return;
  }

  if (command === 'init') {
    await runInit();
    return;
  }

  if (command === 'push') {
    runPush();
    return;
  }

  if (command === 'codesign') {
    runCodesign();
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

module.exports = { run };
