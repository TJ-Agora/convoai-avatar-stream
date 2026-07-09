// Load .env.local for the test run. NOTE: @next/env deliberately skips
// .env.local when NODE_ENV === 'test' (and vitest sets that), so we parse the
// file directly — real env vars still take precedence.
import { readFileSync } from 'fs';

try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch { /* no .env.local — rely on real env */ }

if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
  throw new Error('Tests need KV_REST_API_URL / KV_REST_API_TOKEN in .env.local (Upstash Redis).');
}
