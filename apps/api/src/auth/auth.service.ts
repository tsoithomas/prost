import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import type { UserDto } from '@prost/shared-types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(email: string, password: string): Promise<{ token: string; user: UserDto }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !(await compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const token = await this.jwtService.signAsync({ sub: user.id, email: user.email });
    return { token, user: toUserDto(user) };
  }

  async getUser(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return toUserDto(user);
  }
}

function toUserDto(user: { id: string; email: string; createdAt: Date }): UserDto {
  return { id: user.id, email: user.email, createdAt: user.createdAt.toISOString() };
}
