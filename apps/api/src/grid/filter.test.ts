import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { ColumnMetadata } from '@prost/shared-types';
import { compileWhere } from './filter';

function col(name: string, dataType: string): ColumnMetadata {
  return { name, dataType, nullable: true, isPrimaryKey: false };
}

const TEXT_COL = col('email', 'character varying');
const INT_COL = col('age', 'integer');
const DATE_COL = col('created_at', 'timestamp without time zone');
const BOOL_COL = col('active', 'boolean');
const COLUMNS = [TEXT_COL, INT_COL, DATE_COL, BOOL_COL];

describe('compileWhere — empty filter', () => {
  it('returns empty clause and params for no conditions', () => {
    const result = compileWhere({ conditions: [], combinator: 'and' }, COLUMNS, 0);
    expect(result.clause).toBe('');
    expect(result.params).toEqual([]);
  });
});

describe('compileWhere — single conditions', () => {
  it('eq produces "col" = $n', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'age', operator: 'eq', value: 30 }], combinator: 'and' },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "age" = $1');
    expect(params).toEqual([30]);
  });

  it('neq produces "col" <> $n', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'age', operator: 'neq', value: 0 }], combinator: 'and' },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "age" <> $1');
    expect(params).toEqual([0]);
  });

  it('lt/lte/gt/gte produce correct operators', () => {
    for (const [op, sql] of [['lt', '<'], ['lte', '<='], ['gt', '>'], ['gte', '>=']] as const) {
      const { clause } = compileWhere(
        { conditions: [{ column: 'age', operator: op, value: 18 }], combinator: 'and' },
        COLUMNS, 0,
      );
      expect(clause).toBe(`WHERE "age" ${sql} $1`);
    }
  });

  it('contains puts wildcard in the param, not the SQL', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'email', operator: 'contains', value: 'gmail' }], combinator: 'and' },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "email" ILIKE $1');
    expect(params).toEqual(['%gmail%']);
  });

  it('startsWith puts trailing wildcard in param', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'email', operator: 'startsWith', value: 'admin' }], combinator: 'and' },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "email" ILIKE $1');
    expect(params).toEqual(['admin%']);
  });

  it('endsWith puts leading wildcard in param', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'email', operator: 'endsWith', value: '.com' }], combinator: 'and' },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "email" ILIKE $1');
    expect(params).toEqual(['%.com']);
  });

  it('isNull produces no param', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'email', operator: 'isNull' }], combinator: 'and' },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "email" IS NULL');
    expect(params).toEqual([]);
  });

  it('isNotNull produces no param', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'email', operator: 'isNotNull' }], combinator: 'and' },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "email" IS NOT NULL');
    expect(params).toEqual([]);
  });

  it('in uses = ANY($n) with array param', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'age', operator: 'in', values: [18, 21, 25] }], combinator: 'and' },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "age" = ANY($1)');
    expect(params).toEqual([[18, 21, 25]]);
  });
});

describe('compileWhere — multiple conditions', () => {
  it('joins multiple conditions with AND', () => {
    const { clause, params } = compileWhere(
      {
        conditions: [
          { column: 'age', operator: 'gte', value: 18 },
          { column: 'email', operator: 'contains', value: 'gmail' },
        ],
        combinator: 'and',
      },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "age" >= $1 AND "email" ILIKE $2');
    expect(params).toEqual([18, '%gmail%']);
  });

  it('joins multiple conditions with OR', () => {
    const { clause, params } = compileWhere(
      {
        conditions: [
          { column: 'age', operator: 'lt', value: 18 },
          { column: 'active', operator: 'eq', value: false },
        ],
        combinator: 'or',
      },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "age" < $1 OR "active" = $2');
    expect(params).toEqual([18, false]);
  });

  it('skips param index for isNull conditions mid-list', () => {
    const { clause, params } = compileWhere(
      {
        conditions: [
          { column: 'age', operator: 'eq', value: 30 },
          { column: 'email', operator: 'isNull' },
          { column: 'active', operator: 'eq', value: true },
        ],
        combinator: 'and',
      },
      COLUMNS, 0,
    );
    expect(clause).toBe('WHERE "age" = $1 AND "email" IS NULL AND "active" = $2');
    expect(params).toEqual([30, true]);
  });
});

describe('compileWhere — paramOffset', () => {
  it('offsets $n numbering by paramOffset', () => {
    const { clause, params } = compileWhere(
      { conditions: [{ column: 'age', operator: 'eq', value: 30 }], combinator: 'and' },
      COLUMNS, 2,
    );
    expect(clause).toBe('WHERE "age" = $3');
    expect(params).toEqual([30]);
  });
});

describe('compileWhere — dialect injection', () => {
  it('uses the injected placeholder and quoteIdent functions', () => {
    const { clause } = compileWhere(
      { conditions: [{ column: 'age', operator: 'eq', value: 30 }], combinator: 'and' },
      COLUMNS, 0,
      { placeholder: (i) => `?${i}`, quoteIdent: (s) => `[${s}]` },
    );
    expect(clause).toBe('WHERE [age] = ?1');
  });
});

describe('compileWhere — validation errors', () => {
  it('throws BadRequestException for unknown column', () => {
    expect(() =>
      compileWhere(
        { conditions: [{ column: 'nonexistent', operator: 'eq', value: 1 }], combinator: 'and' },
        COLUMNS, 0,
      ),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequestException for operator invalid for column type (contains on integer)', () => {
    expect(() =>
      compileWhere(
        { conditions: [{ column: 'age', operator: 'contains', value: 'foo' }], combinator: 'and' },
        COLUMNS, 0,
      ),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequestException for startsWith on boolean', () => {
    expect(() =>
      compileWhere(
        { conditions: [{ column: 'active', operator: 'startsWith', value: 'tr' }], combinator: 'and' },
        COLUMNS, 0,
      ),
    ).toThrow(BadRequestException);
  });

  it('throws BadRequestException for lt on boolean', () => {
    expect(() =>
      compileWhere(
        { conditions: [{ column: 'active', operator: 'lt', value: true }], combinator: 'and' },
        COLUMNS, 0,
      ),
    ).toThrow(BadRequestException);
  });
});
