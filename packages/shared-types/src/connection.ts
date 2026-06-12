export interface ConnectionDto {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  sslEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectionDto {
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
}

/** All fields optional; an empty/omitted `password` means "keep the stored credential". */
export interface UpdateConnectionDto {
  name?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslEnabled?: boolean;
}

/**
 * Tests either a saved connection (`id`, falling back to its stored credentials when
 * `password` is blank) or an unsaved set of connection params (all fields required).
 */
export interface TestConnectionDto {
  id?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslEnabled?: boolean;
}

export interface TestConnectionResult {
  ok: boolean;
  message: string;
  serverVersion?: string;
}
