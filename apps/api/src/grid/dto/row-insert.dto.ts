import { IsObject } from 'class-validator';
import type { RowInsertBody } from '@prost/shared-types';

export class RowInsertDto implements RowInsertBody {
  @IsObject()
  values!: Record<string, unknown>;
}
