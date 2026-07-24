import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ConnectionDto } from '@prost/shared-types';
import { ConnectionEnvBadge } from './ConnectionEnvBadge';

function connection(overrides: Partial<ConnectionDto> = {}): ConnectionDto {
  return {
    id: 'conn-1',
    name: 'Demo',
    engine: 'postgres',
    host: 'localhost',
    port: 5432,
    database: 'demo',
    username: 'demo',
    sslEnabled: false,
    sslRejectUnauthorized: true,
    environment: 'dev',
    capabilities: { hasSchemas: true, readOnly: false },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ConnectionEnvBadge', () => {
  it('renders nothing for a writable dev connection', () => {
    const { container } = render(<ConnectionEnvBadge connection={connection()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a PROD badge for a prod connection', () => {
    render(<ConnectionEnvBadge connection={connection({ environment: 'prod' })} />);
    expect(screen.getByText('PROD')).toBeInTheDocument();
  });

  it('shows a STAGING badge for a staging connection', () => {
    render(<ConnectionEnvBadge connection={connection({ environment: 'staging' })} />);
    expect(screen.getByText('STAGING')).toBeInTheDocument();
  });

  it('shows a read-only indicator when the connection is read-only', () => {
    render(
      <ConnectionEnvBadge
        connection={connection({ capabilities: { hasSchemas: true, readOnly: true } })}
      />,
    );
    expect(screen.getByText('Read-only')).toBeInTheDocument();
  });

  it('renders nothing when no connection is active', () => {
    const { container } = render(<ConnectionEnvBadge connection={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
