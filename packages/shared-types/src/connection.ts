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
