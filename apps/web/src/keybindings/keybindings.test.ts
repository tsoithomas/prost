import { describe, expect, it } from 'vitest';
import { chordFromEvent, findKeybindingConflicts, matchesChord, resolveBinding } from './index';

describe('resolveBinding', () => {
  it('returns the default chord when no override exists', () => {
    expect(resolveBinding('command-palette', {})).toBe('mod+k');
  });

  it('prefers an override over the default', () => {
    expect(resolveBinding('command-palette', { 'command-palette': 'mod+p' })).toBe('mod+p');
  });
});

describe('matchesChord', () => {
  function keydown(init: Partial<KeyboardEvent>): KeyboardEvent {
    return new KeyboardEvent('keydown', init);
  }

  it('matches mod+k (Ctrl on non-mac)', () => {
    expect(matchesChord(keydown({ key: 'k', ctrlKey: true }), 'mod+k')).toBe(true);
  });

  it('does not match when an extra modifier is held', () => {
    expect(matchesChord(keydown({ key: 'k', ctrlKey: true, shiftKey: true }), 'mod+k')).toBe(false);
  });

  it('matches mod+shift+enter', () => {
    expect(
      matchesChord(keydown({ key: 'Enter', ctrlKey: true, shiftKey: true }), 'mod+shift+enter'),
    ).toBe(true);
  });

  it('does not match a different key', () => {
    expect(matchesChord(keydown({ key: 'j', ctrlKey: true }), 'mod+k')).toBe(false);
  });
});

describe('chordFromEvent', () => {
  function keydown(init: Partial<KeyboardEvent>): KeyboardEvent {
    return new KeyboardEvent('keydown', init);
  }

  it('returns a modified chord', () => {
    expect(chordFromEvent(keydown({ key: 'k', ctrlKey: true }))).toBe('mod+k');
    expect(chordFromEvent(keydown({ key: 'Enter', ctrlKey: true, shiftKey: true }))).toBe('mod+shift+enter');
  });

  it('rejects a modifier-less key press (would bind globally and fail server validation)', () => {
    expect(chordFromEvent(keydown({ key: 'a' }))).toBeNull();
  });

  it('returns null for a bare modifier press', () => {
    expect(chordFromEvent(keydown({ key: 'Shift', shiftKey: true }))).toBeNull();
  });
});

describe('findKeybindingConflicts', () => {
  it('reports no conflicts for the defaults', () => {
    expect(findKeybindingConflicts({})).toEqual([]);
  });

  it('detects two actions bound to the same chord', () => {
    const conflicts = findKeybindingConflicts({ 'run-statement': 'mod+k' });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.actionIds).toEqual(expect.arrayContaining(['command-palette', 'run-statement']));
  });
});
