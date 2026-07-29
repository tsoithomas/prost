import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { SshAuthMethod, SshConnectionInput } from '@prost/shared-types';

/**
 * The optional SSH-tunnel input fields shared by create/update/test DTOs (Phase 32). `sshSecret`
 * (private key or password) and `sshKeyPassphrase` are write-only — accepted here, never serialized back.
 */
export class SshFieldsDto implements Partial<SshConnectionInput> {
  @IsOptional()
  @IsBoolean()
  sshEnabled?: boolean;

  @IsOptional()
  @IsString()
  sshHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;

  @IsOptional()
  @IsString()
  sshUsername?: string;

  @IsOptional()
  @IsIn(['key', 'password'])
  sshAuthMethod?: SshAuthMethod;

  @IsOptional()
  @IsString()
  sshSecret?: string;

  @IsOptional()
  @IsString()
  sshKeyPassphrase?: string;
}
