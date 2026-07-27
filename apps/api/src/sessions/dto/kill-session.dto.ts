import { IsIn } from 'class-validator';
import type { KillSessionBody, KillSessionMode } from '@prost/shared-types';

export class KillSessionDto implements KillSessionBody {
  @IsIn(['cancel', 'terminate'])
  mode!: KillSessionMode;
}
