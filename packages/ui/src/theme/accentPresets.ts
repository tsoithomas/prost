export interface AccentPreset {
  name: string;
  value: string;
  /** Pre-tuned foreground color for text/icons rendered on top of `value`. */
  fg: string;
}

const blue: AccentPreset = { name: 'Blue', value: '#498fff', fg: '#00285b' };

export const accentPresets: AccentPreset[] = [
  blue,
  { name: 'Sky', value: '#0ea5e9', fg: '#ffffff' },
  { name: 'Cyan', value: '#0891b2', fg: '#ffffff' },
  { name: 'Teal', value: '#0d9488', fg: '#ffffff' },
  { name: 'Green', value: '#2ea043', fg: '#ffffff' },
  { name: 'Lime', value: '#65a30d', fg: '#ffffff' },
  { name: 'Yellow', value: '#eab308', fg: '#1f1300' },
  { name: 'Amber', value: '#f59e0b', fg: '#1f1300' },
  { name: 'Orange', value: '#d97706', fg: '#1f1300' },
  { name: 'Red', value: '#e5484d', fg: '#ffffff' },
  { name: 'Rose', value: '#e93d82', fg: '#ffffff' },
  { name: 'Pink', value: '#d6409f', fg: '#ffffff' },
  { name: 'Purple', value: '#8957e5', fg: '#ffffff' },
  { name: 'Violet', value: '#7c3aed', fg: '#ffffff' },
  { name: 'Indigo', value: '#4f46e5', fg: '#ffffff' },
  { name: 'Slate', value: '#64748b', fg: '#ffffff' },
];

export const defaultAccentPreset = blue;
