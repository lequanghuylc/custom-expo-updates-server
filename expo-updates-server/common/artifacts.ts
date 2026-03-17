import path from 'path';

export type ArtifactMode = 's3' | 'local';

export function getArtifactMode(): ArtifactMode {
  const mode = (process.env.ARTIFACT_MODE ?? '').toLowerCase();
  if (mode === 's3' || mode === 'local') return mode;

  // Back-compat: if S3_BUCKET was configured, assume S3.
  if (process.env.S3_BUCKET) return 's3';

  // Default to legacy local repo `updates/` layout.
  return 'local';
}

export function getArtifactsDir(): string | null {
  const dir = process.env.ARTIFACTS_DIR;
  if (!dir) return null;
  return path.resolve(dir);
}

export function getLocalArtifactsRoot(): string {
  // If ARTIFACTS_DIR is not set, fall back to repo-local `updates/`.
  return getArtifactsDir() ?? path.resolve(process.cwd());
}

