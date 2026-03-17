#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/push.sh \
    --token <UPLOAD_TOKEN> \
    --channel main \
    [--runtimeVersion 2] \
    [--server https://updates.example.com] \
    [--updateId <uuid>]

Notes:
  - This runs `npx expo export`, writes `dist/expoConfig.json`, zips `dist/`, then uploads the same zip twice:
    once as platform=ios and once as platform=android.
  - If --server is not provided, it is derived from app.json `expo.updates.url` (origin only).
EOF
}

SERVER=""
TOKEN=""
CHANNEL="default"
RUNTIME_VERSION=""
UPDATE_ID=""
SLUG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) SERVER="${2:-}"; shift 2;;
    --token) TOKEN="${2:-}"; shift 2;;
    --channel) CHANNEL="${2:-}"; shift 2;;
    --runtimeVersion) RUNTIME_VERSION="${2:-}"; shift 2;;
    --updateId) UPDATE_ID="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown arg: $1" >&2; usage; exit 1;;
  esac
done

if [[ -z "$TOKEN" ]]; then
  echo "Missing --token" >&2
  exit 1
fi

# Resolve server origin from app config if not provided.
if [[ -z "$SERVER" ]]; then
  SERVER="$(
    node -e "const fs=require('fs'); const path=require('path'); const p=path.join(process.cwd(),'app.json'); const json=JSON.parse(fs.readFileSync(p,'utf8')); const url=json?.expo?.updates?.url; if(!url) process.exit(1); const u=new URL(url); process.stdout.write(u.origin);"
  )"
fi

# Resolve slug from app config.
if [[ -z "$SLUG" ]]; then
  SLUG="$(
    node -e "const fs=require('fs'); const path=require('path'); const p=path.join(process.cwd(),'app.json'); const json=JSON.parse(fs.readFileSync(p,'utf8')); const slug=json?.expo?.slug; if(!slug) process.exit(1); process.stdout.write(String(slug));"
  )"
fi

# Resolve runtimeVersion from app config if not provided.
if [[ -z "$RUNTIME_VERSION" ]]; then
  RUNTIME_VERSION="$(
    node -e "const fs = require('fs'); const path = require('path'); const p = path.join(process.cwd(), 'app.json'); const json = JSON.parse(fs.readFileSync(p, 'utf8')); const exp = json.expo; if (!exp || !exp.runtimeVersion) process.exit(1); process.stdout.write(String(exp.runtimeVersion));"
  )"
fi

UPLOAD_URL="${SERVER%/}/api/${SLUG}/updates/upload"
STAMP="$(date +%s)"
ZIP_NAME="update-${CHANNEL}-${RUNTIME_VERSION}-${STAMP}.zip"

echo "Building export..."
npx expo export

echo "Writing dist/expoConfig.json..."
node -e "const fs = require('fs'); const path = require('path'); const p = path.join(process.cwd(), 'app.json'); const json = JSON.parse(fs.readFileSync(p, 'utf8')); const exp = json.expo; if (!exp) process.exit(1); fs.mkdirSync(path.join(process.cwd(), 'dist'), { recursive: true }); fs.writeFileSync(path.join(process.cwd(), 'dist', 'expoConfig.json'), JSON.stringify(exp));"

echo "Creating zip ${ZIP_NAME}..."
rm -f "${ZIP_NAME}"
(cd dist && zip -qr "../${ZIP_NAME}" .)

common_args=(
  -sS
  -X POST "${UPLOAD_URL}"
  -H "Authorization: Bearer ${TOKEN}"
  -F "slug=${SLUG}"
  -F "runtimeVersion=${RUNTIME_VERSION}"
  -F "channel=${CHANNEL}"
  -F "file=@${ZIP_NAME};type=application/zip"
)

if [[ -n "$UPDATE_ID" ]]; then
  common_args+=(-F "updateId=${UPDATE_ID}")
fi

echo "Uploading iOS update..."
curl "${common_args[@]}" -F "platform=ios" | cat
echo ""

echo "Uploading Android update..."
curl "${common_args[@]}" -F "platform=android" | cat
echo ""

echo "Cleaning up zip ${ZIP_NAME}..."
rm -f "${ZIP_NAME}"

echo "Done."

