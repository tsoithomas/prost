export interface UserDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface QueryHistoryDto {
  id: string;
  connectionId: string;
  sql: string;
  executedAt: string;
}

export type ColorMode = 'light' | 'dark' | 'system';

export interface UserPreferenceDto {
  colorMode: ColorMode;
  accentColor: string;
}
