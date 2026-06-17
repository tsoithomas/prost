import { describe, expect, it } from 'vitest';
import {
  SYSTEM_CONNECTION_ID,
  buildSystemConnectionDto,
  buildSystemConnectionParams,
  isSystemConnectionId,
  resolveAppDbFile,
} from './system-connection';

describe('system-connection', () => {
  it('recognizes the system connection id', () => {
    expect(isSystemConnectionId(SYSTEM_CONNECTION_ID)).toBe(true);
    expect(isSystemConnectionId('some-uuid')).toBe(false);
  });

  it('strips the file: prefix and keeps absolute paths', () => {
    expect(resolveAppDbFile('file:/var/lib/prost.db')).toBe('/var/lib/prost.db');
  });

  it('exposes a read-only, schema-less SQLite DTO', () => {
    const dto = buildSystemConnectionDto('file:./data/prost.db');
    expect(dto.id).toBe(SYSTEM_CONNECTION_ID);
    expect(dto.engine).toBe('sqlite');
    expect(dto.capabilities).toEqual({ hasSchemas: false, readOnly: true });
  });

  it('builds read-only connection params for the driver', () => {
    const params = buildSystemConnectionParams('file:/abs/prost.db');
    expect(params.readOnly).toBe(true);
    expect(params.database).toBe('/abs/prost.db');
  });
});
