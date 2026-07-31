import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Keyboard,
  Palette,
  Paintbrush,
  RotateCcw,
  ShieldOff,
  SlidersHorizontal,
  SquareCode,
  Table2,
  Upload,
  User,
} from 'lucide-react';
import { Button, Input, Modal, Tabs, Toast, type TabItem } from '@prost/ui';
import { usePreferences } from '../api/preferences';
import { useSettingsStore } from '../stores/settingsStore';
import { useThemeStore } from '../stores/themeStore';
import { AccountSection } from './settings/AccountSection';
import { AppearanceSection } from './settings/AppearanceSection';
import { BehaviorSection } from './settings/BehaviorSection';
import { EditorSection } from './settings/EditorSection';
import { GridSection } from './settings/GridSection';
import { KeyboardSection } from './settings/KeyboardSection';
import { PrivacySection } from './settings/PrivacySection';
import { ThemeSection } from './settings/ThemeSection';
import {
  applyPreferencesToStore,
  currentPreferencesFromStore,
  DEFAULT_STYLE_PREFERENCES,
} from './settings/applyPreferences';
import { downloadSettings, readSettingsFile } from './settings/settingsExport';
import { useSavePreference } from './useSavePreference';

const TABS: TabItem[] = [
  { id: 'appearance', label: 'Appearance', icon: <Paintbrush size={15} /> },
  { id: 'theme', label: 'Theme', icon: <Palette size={15} /> },
  { id: 'editor', label: 'Editor', icon: <SquareCode size={15} /> },
  { id: 'grid', label: 'Grid', icon: <Table2 size={15} /> },
  { id: 'behavior', label: 'Behavior', icon: <SlidersHorizontal size={15} /> },
  { id: 'privacy', label: 'Privacy', icon: <ShieldOff size={15} /> },
  { id: 'keyboard', label: 'Keyboard', icon: <Keyboard size={15} /> },
  { id: 'account', label: 'Account', icon: <User size={15} /> },
];

export function SettingsModal() {
  const open = useSettingsStore((s) => s.open);
  const initialSection = useSettingsStore((s) => s.section);
  const closeSettings = useSettingsStore((s) => s.closeSettings);

  const [active, setActive] = useState(initialSection);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  // Seed the active tab from the store each time the modal is opened.
  useEffect(() => {
    if (open) {
      setActive(initialSection);
      setQuery('');
      setError(null);
      setNotice(null);
    }
  }, [open, initialSection]);

  const save = useSavePreference(setError);
  const { refetch } = usePreferences();

  function handleReset() {
    applyPreferencesToStore(DEFAULT_STYLE_PREFERENCES);
    useThemeStore.getState().applyPalette(null);
    save(DEFAULT_STYLE_PREFERENCES);
    setNotice('Appearance reset to defaults.');
  }

  function handleExport() {
    downloadSettings(currentPreferencesFromStore());
  }

  async function handleImportFile(file: File) {
    setError(null);
    try {
      const parsed = await readSettingsFile(file);
      // The server re-validates on save; apply the persisted result to the store on success.
      save(parsed);
      applyPreferencesToStore(parsed);
      await refetch();
      setNotice('Settings imported.');
    } catch {
      setError('Could not read that settings file — expected exported Prost settings JSON.');
    }
  }

  const q = query.trim().toLowerCase();

  return (
    <Modal
      open={open}
      onClose={closeSettings}
      title="Settings"
      hideTitle
      className="h-[min(90vh,44rem)] w-full max-w-3xl gap-0 p-0 max-md:h-full max-md:max-w-none"
    >
      <div className="flex items-center justify-between border-b border-border px-lg py-md">
        <h2 className="text-sm font-semibold text-text">Settings</h2>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings…"
          aria-label="Search settings"
          className="w-48 text-xs max-md:w-32"
        />
      </div>

      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav className="shrink-0 border-r border-border p-sm max-md:border-b max-md:border-r-0">
          <Tabs items={TABS} value={active} onChange={setActive} aria-label="Settings sections" className="w-44 max-md:w-full" />
        </nav>

        <div className="min-h-0 flex-1 overflow-y-auto p-lg">
          {error ? <Toast variant="danger" message={error} onDismiss={() => setError(null)} /> : null}
          {notice ? <Toast variant="success" message={notice} onDismiss={() => setNotice(null)} /> : null}
          {active === 'appearance' ? <AppearanceSection save={save} query={q} /> : null}
          {active === 'theme' ? <ThemeSection save={save} query={q} /> : null}
          {active === 'editor' ? <EditorSection save={save} query={q} /> : null}
          {active === 'grid' ? <GridSection save={save} query={q} /> : null}
          {active === 'behavior' ? <BehaviorSection save={save} query={q} /> : null}
          {active === 'privacy' ? <PrivacySection save={save} query={q} /> : null}
          {active === 'keyboard' ? <KeyboardSection save={save} /> : null}
          {active === 'account' ? <AccountSection /> : null}
        </div>
      </div>

      <div className="flex items-center justify-between gap-sm border-t border-border px-lg py-md max-md:flex-wrap">
        <Button variant="ghost" size="sm" onClick={handleReset}>
          <RotateCcw size={14} />
          Reset appearance
        </Button>
        <div className="flex items-center gap-sm">
          <input
            ref={importRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportFile(file);
              e.target.value = '';
            }}
          />
          <Button variant="ghost" size="sm" onClick={() => importRef.current?.click()}>
            <Upload size={14} />
            Import
          </Button>
          <Button variant="secondary" size="sm" onClick={handleExport}>
            <Download size={14} />
            Export
          </Button>
          <Button variant="secondary" size="sm" onClick={closeSettings}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
