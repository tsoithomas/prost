import { IsString, IsUrl } from 'class-validator';
import type { LlmProbeBody } from '@prost/shared-types';

export class ProbeLlmEndpointDto implements LlmProbeBody {
  @IsUrl({ require_tld: false, require_protocol: true })
  baseUrl!: string;

  @IsString()
  apiKey!: string;
}
