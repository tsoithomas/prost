import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { compare, hash } from 'bcrypt';
import type { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

function makeService(user: { id: string; email: string; passwordHash: string }) {
  const update = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    user: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ ...user, createdAt: new Date() }),
      update,
    },
  } as unknown as PrismaService;
  const jwt = { signAsync: vi.fn() } as unknown as JwtService;
  return { service: new AuthService(prisma, jwt), update };
}

describe('AuthService.changePassword', () => {
  it('re-hashes the new password when the current one matches', async () => {
    const passwordHash = await hash('current-pw', 10);
    const { service, update } = makeService({ id: 'u1', email: 'a@b.c', passwordHash });

    await service.changePassword('u1', 'current-pw', 'brand-new-pw');

    expect(update).toHaveBeenCalledTimes(1);
    const newHash = update.mock.calls[0]![0].data.passwordHash as string;
    expect(newHash).not.toBe(passwordHash);
    expect(await compare('brand-new-pw', newHash)).toBe(true);
  });

  it('rejects when the current password is wrong and never writes', async () => {
    const passwordHash = await hash('current-pw', 10);
    const { service, update } = makeService({ id: 'u1', email: 'a@b.c', passwordHash });

    await expect(service.changePassword('u1', 'wrong-pw', 'brand-new-pw')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(update).not.toHaveBeenCalled();
  });
});
