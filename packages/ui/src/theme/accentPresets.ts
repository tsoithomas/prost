export interface AccentPreset {
  name: string;
  value: string;
  /** Pre-tuned foreground color for text/icons rendered on top of `value`. */
  fg: string;
}

const blue: AccentPreset = { name: 'Blue', value: '#498fff', fg: '#00285b' };

export const accentPresets: AccentPreset[] = [
  blue,
  { name: 'Green', value: '#2ea043', fg: '#ffffff' },
  { name: 'Purple', value: '#8957e5', fg: '#ffffff' },
  { name: 'Orange', value: '#d97706', fg: '#1f1300' },
  { name: 'Pink', value: '#d6409f', fg: '#ffffff' },
];

export const defaultAccentPreset = blue;
