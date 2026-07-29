import type { UserPreferenceDto } from '@prost/shared-types';

/** Serializes the user's preferences to a downloadable JSON file (app-DB prefs only — no secrets). */
export function downloadSettings(prefs: UserPreferenceDto): void {
  const blob = new Blob([JSON.stringify(prefs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'prost-settings.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Reads and JSON-parses an uploaded settings file into a partial DTO (server re-validates on save). */
export async function readSettingsFile(file: File): Promise<Partial<UserPreferenceDto>> {
  const text = await file.text();
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Settings file must be a JSON object.');
  }
  return parsed as Partial<UserPreferenceDto>;
}
