import { Body, Controller, Get, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { UserDto } from '@prost/shared-types';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';
import { CurrentUser, type AuthenticatedUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: Number(process.env['THROTTLE_LOGIN_TTL_MS'] ?? 60_000), limit: Number(process.env['THROTTLE_LOGIN_LIMIT'] ?? 5) } })
  @Post('login')
  login(@Body() dto: LoginDto): Promise<{ token: string; user: UserDto }> {
    return this.authService.login(dto.email, dto.password);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserDto> {
    return this.authService.getUser(user.userId);
  }
}
