import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { QueryPlanResult } from '@prost/shared-types';
import { QueryPlanView } from './QueryPlanView';

const plan: QueryPlanResult = {
  analyze: false,
  format: 'json',
  planText: 'Hash Join ...',
  executionTimeMs: 4,
  root: {
    nodeType: 'Hash Join',
    detail: 'Inner',
    estimatedCost: 100,
    estimatedRows: 200,
    children: [
      { nodeType: 'Seq Scan', detail: 'orders', estimatedCost: 90, estimatedRows: 100, children: [] },
      { nodeType: 'Index Scan', detail: 'users', estimatedCost: 10, estimatedRows: 100, children: [] },
    ],
  },
};

describe('QueryPlanView', () => {
  it('renders the plan node tree', () => {
    render(<QueryPlanView plan={plan} />);
    expect(screen.getByText('Hash Join')).toBeInTheDocument();
    expect(screen.getByText('orders')).toBeInTheDocument();
    expect(screen.getByText('users')).toBeInTheDocument();
    expect(screen.getByText('Estimated')).toBeInTheDocument();
  });

  it('heat-weights nodes by relative cost — the cheapest node stays cool', () => {
    const { container } = render(<QueryPlanView plan={plan} />);
    // root cost 100 (max) and Seq Scan 90/100 are hot; Index Scan 10/100 is cool.
    expect(container.querySelectorAll('[data-heat="hot"]').length).toBeGreaterThanOrEqual(1);
    const indexRow = screen.getByText('Index Scan').closest('[data-heat]');
    expect(indexRow?.getAttribute('data-heat')).toBe('cool');
  });

  it('switches to actual timings under analyze', () => {
    render(
      <QueryPlanView
        plan={{ ...plan, analyze: true, root: { ...plan.root, actualTimeMs: 5, actualRows: 200 } }}
      />,
    );
    expect(screen.getByText(/Analyze/)).toBeInTheDocument();
    expect(screen.getByText('5.00 ms')).toBeInTheDocument();
  });
});
