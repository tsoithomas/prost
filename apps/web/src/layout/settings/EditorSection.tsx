import {
  EDITOR_FONT_SIZES,
  LINE_NUMBER_MODES,
  MONO_FONT_FAMILIES,
  TAB_SIZES,
  type EditorFontSize,
  type EditorPreferences,
  type LineNumberMode,
  type MonoFontFamily,
  type TabSize,
} from '@prost/shared-types';
import { useThemeStore } from '../../stores/themeStore';
import { SegmentedGroup } from '../SegmentedGroup';
import { match, SettingSwitch, type SectionProps } from './controls';

const editorFontLabels: Record<EditorFontSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };
const monoLabels: Record<MonoFontFamily, string> = {
  'jetbrains-mono': 'JetBrains Mono',
  'system-mono': 'System Mono',
  'fira-code': 'Fira Code',
};
const lineNumberLabels: Record<LineNumberMode, string> = { on: 'On', off: 'Off', relative: 'Relative' };

export function EditorSection({ save, query }: SectionProps) {
  const monoFontFamily = useThemeStore((s) => s.monoFontFamily);
  const editor = useThemeStore((s) => s.editor);
  const setMonoFontFamily = useThemeStore((s) => s.setMonoFontFamily);
  const setEditorPrefs = useThemeStore((s) => s.setEditorPrefs);

  function updateEditor(patch: Partial<EditorPreferences>) {
    const next = { ...editor, ...patch };
    setEditorPrefs(next);
    save({ editor: next });
  }
  function handleEditorFont(family: MonoFontFamily) {
    setMonoFontFamily(family);
    save({ monoFontFamily: family });
  }

  return (
    <div className="flex flex-col gap-lg">
      {match('Editor font size', query) ? (
        <SegmentedGroup
          label="Editor font size"
          options={EDITOR_FONT_SIZES}
          value={editor.fontSize ?? 'md'}
          render={(s) => editorFontLabels[s]}
          onSelect={(fontSize: EditorFontSize) => updateEditor({ fontSize })}
        />
      ) : null}
      {match('Editor font family', query) ? (
        <SegmentedGroup
          label="Editor font"
          options={MONO_FONT_FAMILIES}
          value={monoFontFamily ?? 'jetbrains-mono'}
          render={(f) => monoLabels[f]}
          onSelect={handleEditorFont}
        />
      ) : null}
      {match('Tab size', query) ? (
        <SegmentedGroup
          label="Tab size"
          options={TAB_SIZES}
          value={editor.tabSize ?? 2}
          render={(n) => String(n)}
          onSelect={(tabSize: TabSize) => updateEditor({ tabSize })}
        />
      ) : null}
      {match('Insert spaces', query) ? (
        <SettingSwitch
          label="Insert spaces"
          description="Use spaces instead of tab characters."
          checked={editor.insertSpaces ?? true}
          onChange={(insertSpaces) => updateEditor({ insertSpaces })}
        />
      ) : null}
      {match('Word wrap', query) ? (
        <SettingSwitch label="Word wrap" checked={editor.wordWrap ?? false} onChange={(wordWrap) => updateEditor({ wordWrap })} />
      ) : null}
      {match('Line numbers', query) ? (
        <SegmentedGroup
          label="Line numbers"
          options={LINE_NUMBER_MODES}
          value={editor.lineNumbers ?? 'on'}
          render={(m) => lineNumberLabels[m]}
          onSelect={(lineNumbers: LineNumberMode) => updateEditor({ lineNumbers })}
        />
      ) : null}
      {match('Minimap', query) ? (
        <SettingSwitch label="Minimap" checked={editor.minimap ?? false} onChange={(minimap) => updateEditor({ minimap })} />
      ) : null}
      {match('Format on run', query) ? (
        <SettingSwitch
          label="Format on run"
          description="Tidy the SQL before it executes."
          checked={editor.formatOnRun ?? false}
          onChange={(formatOnRun) => updateEditor({ formatOnRun })}
        />
      ) : null}
    </div>
  );
}
