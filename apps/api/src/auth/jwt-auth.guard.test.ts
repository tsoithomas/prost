import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { AuthenticatedUser } from './current-user.decorator';

interface MockRequest {
  headers: Record<string, string | undefined>;
  user?: AuthenticatedUser;
}

function createContext(headers: Record<string, string | undefined>, isPublic = false): {
  context: ExecutionContext;
  request: MockRequest;
} {
  const handler = () => undefined;
  if (isPublic) {
    Reflect.defineMetadata(IS_PUBLIC_KEY, true, handler);
  }
  const request: MockRequest = { headers };
  const context = {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('JwtAuthGuard', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });
  const guard = new JwtAuthGuard(jwtService, new Reflector());

  it('allows @Public() routes without a token', async () => {
    const { context } = createContext({}, true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects requests with no Authorization header', async () => {
    const { context } = createContext({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a header that is not a Bearer token', async () => {
    const { context } = createContext({ authorization: 'Basic dXNlcjpwYXNz' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an invalid or expired token', async () => {
    const { context } = createContext({ authorization: 'Bearer not-a-real-token' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts a valid token and attaches the user to the request', async () => {
    const token = await jwtService.signAsync({ sub: 'user-1', email: 'a@b.com' });
    const { context, request } = createContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ userId: 'user-1', email: 'a@b.com' });
  });
});
