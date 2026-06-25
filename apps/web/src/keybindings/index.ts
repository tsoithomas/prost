import { KEYBINDING_ACTIONS, type KeybindingMap } from '@prost/shared-types';

const MODIFIERS = new Set(['mod', 'ctrl', 'cmd', 'shift', 'alt']);

const DEFAULT_CHORDS: Record<string, string> = Object.fromEntries(
  KEYBINDING_ACTIONS.map((a) => [a.id, a.defaultChord]),
);

const isMac =
  typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/** The effective chord for an action: the user's override if present, else the registered default. */
export function resolveBinding(actionId: string, overrides: KeybindingMap): string {
  return overrides[actionId] ?? DEFAULT_CHORDS[actionId] ?? '';
}

interface ParsedChord {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseChord(chord: string): ParsedChord | null {
  const tokens = chord.toLowerCase().split('+');
  const key = tokens[tokens.length - 1];
  if (!key || MODIFIERS.has(key)) return null;
  const mods = tokens.slice(0, -1);
  const parsed: ParsedChord = { ctrl: false, meta: false, shift: false, alt: false, key };
  for (const mod of mods) {
    if (mod === 'mod') (isMac ? (parsed.meta = true) : (parsed.ctrl = true));
    else if (mod === 'ctrl') parsed.ctrl = true;
    else if (mod === 'cmd') parsed.meta = true;
    else if (mod === 'shift') parsed.shift = true;
    else if (mod === 'alt') parsed.alt = true;
  }
  return parsed;
}

/** Whether a keyboard event exactly matches a chord (modifier set + key, no extras). */
export function matchesChord(event: KeyboardEvent, chord: string): boolean {
  const parsed = parseChord(chord);
  if (!parsed) return false;
  return (
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.shiftKey === parsed.shift &&
    event.altKey === parsed.alt &&
    event.key.toLowerCase() === parsed.key
  );
}

/** Canonical chord form (modifiers sorted) so equivalent chords compare equal. */
function canonical(chord: string): string {
  const tokens = chord.toLowerCase().split('+');
  const key = tokens[tokens.length - 1];
  const mods = tokens.slice(0, -1).sort();
  return [...mods, key].join('+');
}

export interface KeybindingConflict {
  chord: string;
  actionIds: string[];
}

/**
 * Returns chords bound to more than one action under the effective map (overrides over defaults).
 * Surfaced as a warning in the editor — never silently dropped (principle §11).
 */
export function findKeybindingConflicts(overrides: KeybindingMap): KeybindingConflict[] {
  const byChord = new Map<string, string[]>();
  for (const action of KEYBINDING_ACTIONS) {
    const chord = canonical(resolveBinding(action.id, overrides));
    const list = byChord.get(chord) ?? [];
    list.push(action.id);
    byChord.set(chord, list);
  }
  return [...byChord.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([chord, actionIds]) => ({ chord, actionIds }));
}

/** Builds a chord string from a keydown event (for the "press a key" capture in the editor). */
export function chordFromEvent(event: KeyboardEvent): string | null {
  const key = event.key.toLowerCase();
  if (MODIFIERS.has(key) || ['control', 'meta', 'os'].includes(key)) return null;
  const mods: string[] = [];
  if (event.ctrlKey || event.metaKey) mods.push('mod');
  if (event.shiftKey) mods.push('shift');
  if (event.altKey) mods.push('alt');
  // Require at least one modifier: a bare key (e.g. "a") would bind globally and is rejected by
  // the server's CHORD_PATTERN. Returning null lets the recorder keep listening for a real chord.
  if (mods.length === 0) return null;
  const normalizedKey = key === 'enter' ? 'enter' : key.length === 1 ? key : null;
  if (!normalizedKey) return null;
  return [...mods, normalizedKey].join('+');
}

/** Human-readable chord, e.g. `mod+shift+enter` → `⌘⇧Enter` (mac) / `Ctrl+Shift+Enter`. */
export function formatChord(chord: string): string {
  const tokens = chord.split('+');
  const key = tokens[tokens.length - 1] ?? '';
  const label = (t: string): string => {
    switch (t) {
      case 'mod':
        return isMac ? '⌘' : 'Ctrl';
      case 'ctrl':
        return 'Ctrl';
      case 'cmd':
        return '⌘';
      case 'shift':
        return isMac ? '⇧' : 'Shift';
      case 'alt':
        return isMac ? '⌥' : 'Alt';
      default:
        return t.length === 1 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1);
    }
  };
  const sep = isMac ? '' : '+';
  return [...tokens.slice(0, -1).map(label), label(key)].join(sep);
}
