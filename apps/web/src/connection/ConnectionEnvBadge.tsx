import { Lock } from 'lucide-react';
import clsx from 'clsx';
import type { ConnectionDto, ConnectionEnvironment } from '@prost/shared-types';
import { Badge } from '@prost/ui';

/**
 * Environment chip presentation (Phase 25). `prod` and `staging` use fixed, mode-stable palette
 * colors (solid red vs. bright amber) rather than the semantic danger/warning tokens, which sit too
 * close together in dark mode — so the two are never mistaken for each other. `dev` gets no chip.
 */
const ENV_CHIP: Record<ConnectionEnvironment, { label: string; className: string } | null> = {
  dev: null,
  staging: { label: 'STAGING', className: 'bg-amber-400 text-black' },
  prod: { label: 'PROD', className: 'bg-red-600 text-white' },
};

/**
 * Shows the active connection's environment (`PROD`/`STAGING`) and a read-only indicator. Renders
 * nothing for a plain writable dev connection so the common case stays uncluttered.
 */
export function ConnectionEnvBadge({ connection }: { connection?: ConnectionDto }) {
  if (!connection) return null;
  const chip = ENV_CHIP[connection.environment];
  const readOnly = connection.capabilities.readOnly;
  if (!chip && !readOnly) return null;

  return (
    <span className="flex items-center gap-1">
      {chip ? (
        <span
          className={clsx(
            'inline-flex items-center rounded-full px-sm py-[1px] text-xs font-semibold',
            chip.className,
          )}
        >
          {chip.label}
        </span>
      ) : null}
      {readOnly ? (
        <Badge variant="neutral" className="flex items-center gap-0.5" title="This connection is read-only">
          <Lock size={10} />
          Read-only
        </Badge>
      ) : null}
    </span>
  );
}
