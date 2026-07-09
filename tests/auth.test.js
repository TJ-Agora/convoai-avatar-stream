import { describe, it, expect, vi, afterEach } from 'vitest';
import { authMode } from '../lib/auth.ts';

// authMode() is the switch that decides whether production is gated — pin all
// of its rules. (Pure env logic; no cookies involved.)

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authMode()', () => {
  it('unset in non-production → bypass (dev default, no credentials needed)', () => {
    vi.stubEnv('AUTH_MODE', '');
    expect(authMode()).toBe('bypass'); // vitest runs with NODE_ENV=test
  });

  it('bypass in non-production → bypass', () => {
    vi.stubEnv('AUTH_MODE', 'bypass');
    expect(authMode()).toBe('bypass');
  });

  it('sso is always sso', () => {
    vi.stubEnv('AUTH_MODE', 'sso');
    expect(authMode()).toBe('sso');
  });

  it('unset in production → sso (fails closed)', () => {
    vi.stubEnv('AUTH_MODE', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(authMode()).toBe('sso');
  });

  it('bypass in production without override → sso (stray env var cannot disable auth)', () => {
    vi.stubEnv('AUTH_MODE', 'bypass');
    vi.stubEnv('NODE_ENV', 'production');
    expect(authMode()).toBe('sso');
  });

  it('bypass in production WITH explicit override → bypass (the temporary pre-creds state)', () => {
    vi.stubEnv('AUTH_MODE', 'bypass');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_BYPASS_IN_PRODUCTION', 'true');
    expect(authMode()).toBe('bypass');
  });
});
