export function getPublicBaseUrl(): string {
  // Prefer PUBLIC_BASE_URL because HOSTNAME is commonly set by the OS/process manager
  // to the machine hostname (e.g. "e28c89dd694d"), which breaks absolute URLs.
  const base = process.env.PUBLIC_BASE_URL ?? process.env.HOSTNAME;
  if (!base) {
    throw new Error('Missing PUBLIC_BASE_URL (or HOSTNAME fallback)');
  }
  return base.replace(/\/+$/, '');
}

