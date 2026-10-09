import type { Settings } from '../../meta/profile';
import type { App, Screen } from '../app';
import { h } from '../dom';
import { icon } from '../icons';
import { confirmDialog } from '../overlay';

const SAVE_KEY_HINT = 'neon-arcade-save';

export function settingsScreen(app: App): Screen {
  const el = h('section', { class: 'screen' });
  const render = () => {
    const s = app.settings;
    const slider = (key: 'masterVolume' | 'sfxVolume' | 'musicVolume', label: string) => {
      const out = h('output', { text: `${Math.round(s[key] * 100)}%` });
      const input = h('input', {
        class: 'range',
        attrs: {
          type: 'range',
          min: 0,
          max: 100,
          step: 5,
          value: Math.round(s[key] * 100),
          'aria-label': label,
        },
      });
      input.addEventListener('input', () => {
        out.textContent = `${input.value}%`;
        app.updateSettings({ [key]: Number(input.value) / 100 } as Partial<Settings>);
      });
      input.addEventListener('change', () => app.sfx('click'));
      return h(
        'label',
        { class: 'setting' },
        h('span', { class: 'setting__label', text: label }),
        input,
        out,
      );
    };
    const toggle = (key: 'muted' | 'reducedMotion' | 'showFps' | 'haptics', label: string, hint: string) => {
      const input = h('input', {
        class: 'switch',
        attrs: { type: 'checkbox', role: 'switch', checked: s[key] },
      });
      input.addEventListener('change', () => {
        app.updateSettings({ [key]: input.checked } as Partial<Settings>);
        app.sfx('click');
      });
      return h(
        'label',
        { class: 'setting' },
        h('span', { class: 'setting__label' }, label, h('small', { class: 'muted', text: hint })),
        input,
      );
    };
    const touchSelect = h(
      'select',
      { class: 'select', attrs: { 'aria-label': 'On-screen controls' } },
      ...(['auto', 'on', 'off'] as const).map((v) =>
        h('option', {
          text: v === 'auto' ? 'Automatic' : v === 'on' ? 'Always show' : 'Hide',
          attrs: { value: v, selected: s.touchControls === v },
        }),
      ),
    );
    touchSelect.addEventListener('change', () =>
      app.updateSettings({ touchControls: touchSelect.value as Settings['touchControls'] }),
    );

    const fileInput = h('input', { attrs: { type: 'file', accept: 'application/json,.json', hidden: true } });
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > 2_000_000) {
        app.toaster.show({
          title: 'Import failed',
          body: 'File is too large.',
          tone: 'error',
          icon: 'close',
        });
        return;
      }
      const ok = await confirmDialog(
        app.overlayHost,
        'Import save?',
        'This replaces your current progress with the imported file.',
        'Import',
        true,
      );
      if (!ok) return;
      const text = await file.text();
      if (app.arcade.store.importJson(text)) {
        app.arcade.ensureMissions();
        app.updateSettings({});
        app.toaster.show({ title: 'Save imported', icon: 'upload', tone: 'success' });
        render();
      } else {
        app.toaster.show({
          title: 'Import failed',
          body: 'That file is not a valid Neon Arcade save.',
          tone: 'error',
          icon: 'close',
        });
      }
    });

    const exportSave = () => {
      const blob = new Blob([app.arcade.store.exportJson()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = h('a', {
        attrs: { href: url, download: `${SAVE_KEY_HINT}-${new Date().toISOString().slice(0, 10)}.json` },
      });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      app.toaster.show({ title: 'Save exported', icon: 'download', tone: 'success', ms: 1800 });
    };

    const reset = async () => {
      const ok = await confirmDialog(
        app.overlayHost,
        'Reset all progress?',
        'Coins, levels, skins, achievements and records will be erased. This cannot be undone.',
        'Reset everything',
        true,
      );
      if (!ok) return;
      app.arcade.resetProgress();
      app.toaster.show({ title: 'Progress reset', icon: 'trash', tone: 'info' });
      render();
    };

    el.replaceChildren(
      h('header', { class: 'screen__head' }, h('h1', { text: 'Settings' })),
      h(
        'div',
        { class: 'settings-grid' },
        h(
          'section',
          { class: 'panel' },
          h('h3', null, icon('volume'), 'Audio'),
          slider('masterVolume', 'Master volume'),
          slider('sfxVolume', 'Sound effects'),
          slider('musicVolume', 'Music'),
          toggle('muted', 'Mute all', 'Shortcut: M while playing'),
        ),
        h(
          'section',
          { class: 'panel' },
          h('h3', null, icon('settings'), 'Gameplay & accessibility'),
          toggle('reducedMotion', 'Reduce motion', 'Disables screen shake, flashes and heavy particles'),
          toggle('haptics', 'Vibration', 'On supported mobile devices'),
          toggle('showFps', 'Show FPS', 'Frame-rate counter while playing'),
          h(
            'label',
            { class: 'setting' },
            h(
              'span',
              { class: 'setting__label' },
              'On-screen controls',
              h('small', { class: 'muted', text: 'Touch buttons for games that need them' }),
            ),
            touchSelect,
          ),
        ),
        h(
          'section',
          { class: 'panel' },
          h('h3', null, icon('download'), 'Your data'),
          h('p', {
            class: 'muted small',
            text: 'Progress is stored locally in this browser. Export a backup to move it to another device.',
          }),
          h(
            'div',
            { class: 'button-row' },
            h(
              'button',
              { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: exportSave } },
              icon('download'),
              'Export save',
            ),
            h(
              'button',
              { class: 'btn btn--ghost', attrs: { type: 'button' }, on: { click: () => fileInput.click() } },
              icon('upload'),
              'Import save',
            ),
            h(
              'button',
              { class: 'btn btn--danger', attrs: { type: 'button' }, on: { click: () => void reset() } },
              icon('trash'),
              'Reset progress',
            ),
            fileInput,
          ),
        ),
        h(
          'section',
          { class: 'panel' },
          h('h3', null, icon('sparkle'), 'About'),
          h('p', {
            class: 'muted small',
            text: `Neon Arcade v${__APP_VERSION__}. All graphics and audio are generated in real time — no downloads, works offline once loaded.`,
          }),
          h('p', {
            class: 'muted small',
            text: 'Keyboard: arrows/WASD move · Space/Enter action · Shift/X secondary · Esc/P pause · M mute. Gamepads are supported.',
          }),
        ),
      ),
    );
  };
  render();
  return { el };
}
