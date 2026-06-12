import { IsObject } from 'class-validator';
import type { RowDeleteBody } from '@prost/shared-types';

export class RowDeleteDto implements RowDeleteBody {
  @IsObject()
  primaryKey!: Record<string, unknown>;
}
