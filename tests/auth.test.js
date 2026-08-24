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

// Open-redirect guard for the post-login return path (?next=).
import { sanitizeReturnPath } from '../lib/auth.ts';

describe('sanitizeReturnPath', () => {
  it('accepts same-origin relative paths with query strings', () => {
    expect(sanitizeReturnPath('/?avatar=lemonslice')).toBe('/?avatar=lemonslice');
    expect(sanitizeReturnPath('/manage/abc123')).toBe('/manage/abc123');
  });
  it('rejects absolute, protocol-relative, and empty values', () => {
    expect(sanitizeReturnPath('https://evil.example')).toBeNull();
    expect(sanitizeReturnPath('//evil.example')).toBeNull();
    expect(sanitizeReturnPath('/\\evil.example')).toBeNull();
    expect(sanitizeReturnPath('')).toBeNull();
    expect(sanitizeReturnPath(null)).toBeNull();
  });
  it('rejects control-character smuggling (WHATWG parsers strip tab/CR/LF)', () => {
    // ?next=%2F%09%2Fevil.example → "/\t/evil.example" → would resolve as
    // protocol-relative "//evil.example" without the control-char guard.
    expect(sanitizeReturnPath('/\t/evil.example')).toBeNull();
    expect(sanitizeReturnPath('/\n/evil.example')).toBeNull();
    expect(sanitizeReturnPath('/\r/evil.example')).toBeNull();
    expect(sanitizeReturnPath('/\u0000/x')).toBeNull();
  });
});
