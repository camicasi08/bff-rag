const DEFAULT_BFF_URL = 'http://localhost:3000';

export function getBffBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BFF_URL ?? DEFAULT_BFF_URL;
}
