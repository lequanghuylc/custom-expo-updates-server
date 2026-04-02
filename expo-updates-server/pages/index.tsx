import Head from 'next/head';
export default function Home() {
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 820, margin: '0 auto', padding: 24, lineHeight: 1.5 }}>
      <Head>
        <title>Custom Expo Updates Server</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <main>
        <h1>Custom Expo Updates Server</h1>
        <p>Use the npm CLI package to configure and publish OTA updates from your Expo app.</p>
        <p>
          Install in your app repo: <code>npm install expo-updates-custom</code> or{' '}
          <code>yarn add expo-updates-custom</code>.
        </p>
        <p>
          Generate your own code-signing keys in app repo: <code>npx expo-updates-custom codesign</code>, then copy{' '}
          <code>code-signing/private-key.pem</code> to server repo and set <code>PRIVATE_KEY_PATH</code>.
        </p>
        <h2>Quick start</h2>
        <ol>
          <li>
            In your Expo app directory, run: <code>npx expo-updates-custom init</code>
          </li>
          <li>
            Apply native update config changes: <code>npx expo prebuild</code>
          </li>
          <li>
            Publish an OTA update: <code>npx expo-updates-custom push</code>
          </li>
        </ol>
        <p>
          <code>init</code> updates <code>app.json</code> (<code>expo.updates</code>, including packaged code-signing
          cert path), saves push token, and removes <code>expo.extra.eas</code>.
        </p>
        <p>
          <code>push</code> exports the update, zips artifacts, then uploads iOS and Android updates to{' '}
          <code>/api/&lt;slug&gt;/updates/upload</code>.
        </p>
      </main>
    </div>
  );
}
