import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { NewColumnDto } from './create-table.dto';

describe('NewColumnDto', () => {
  it('preserves an optional autoIncrement boolean through whitelist validation', async () => {
    const dto = plainToInstance(NewColumnDto, {
      name: 'id',
      type: 'int',
      nullable: false,
      isPrimaryKey: true,
      autoIncrement: true,
      unknown: 'removed',
    });

    expect(await validate(dto, { whitelist: true })).toEqual([]);
    expect(dto.autoIncrement).toBe(true);
    expect(dto).not.toHaveProperty('unknown');
  });
});
