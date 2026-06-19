import { describe, expect, it } from 'vitest';
import { API_ROUTE_PREFIXES, isApiRoute } from './spa-route';

describe('isApiRoute', () => {
  it('matches every top-level API prefix, bare and nested', () => {
    for (const prefix of API_ROUTE_PREFIXES) {
      expect(isApiRoute(`/${prefix}`)).toBe(true);
      expect(isApiRoute(`/${prefix}/anything/deep`)).toBe(true);
      expect(isApiRoute(prefix)).toBe(true); // already-stripped leading slash
    }
  });

  it('matches database-engines (regression: it was missing, so the SPA shadowed it)', () => {
    expect(isApiRoute('/database-engines')).toBe(true);
    expect(isApiRoute('/database-engines/postgres')).toBe(true);
  });

  it('does not match SPA client-side routes', () => {
    expect(isApiRoute('/app')).toBe(false);
    expect(isApiRoute('/app/connections')).toBe(false);
    expect(isApiRoute('/login')).toBe(false);
    expect(isApiRoute('/')).toBe(false);
    expect(isApiRoute('')).toBe(false);
  });

  it('does not match a path that merely starts with a prefix string but is a different segment', () => {
    expect(isApiRoute('/authentication')).toBe(false);
    expect(isApiRoute('/connections-archive')).toBe(false);
  });
});
