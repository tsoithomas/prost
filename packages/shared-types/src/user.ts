export interface UserDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface QueryHistoryDto {
  id: string;
  connectionId: string;
  /** Owning connection's display name — needed for the cross-connection ("All connections") view. */
  connectionName: string;
  sql: string;
  executedAt: string;
  starred: boolean;
  label?: string;
}

/** Fields a user can change on a history entry: star it, or give it a friendly label. */
export interface UpdateHistoryRequest {
  /** `null` clears the label; `undefined` leaves it unchanged. */
  label?: string | null;
  starred?: boolean;
}

/** Query params for the bounded, server-side history search. Omitting `connectionId` = all connections. */
export interface HistoryQuery {
  search?: string;
  connectionId?: string;
  limit?: number;
}

/** A single exported history entry — SQL text + metadata only, never result data (principle §1). */
export interface HistoryExportEntry {
  sql: string;
  executedAt: string;
  connectionName: string;
  starred: boolean;
  label?: string;
}

export type ColorMode = 'light' | 'dark' | 'system';

export interface UserPreferenceDto {
  colorMode: ColorMode;
  accentColor: string;
}
