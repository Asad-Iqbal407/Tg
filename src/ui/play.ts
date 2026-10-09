import { GameLoop, Viewport } from '../core/engine';
import { Input } from '../core/input';
import { Rng } from '../core/rng';
import type { BoostId, GameDefinition, GameInstance, GameResult } from '../games/types';
import type { RunSummary, RunTicket } from '../meta/arcade';
import type { App } from './app';
import { fmt, h, isTouchDevice } from './dom';
import { icon } from './icons';
import { Modal } from './overlay';
import { showResults } from './results';

/** Runs shorter than this with zero score are discarded instead of recorded. */
const TRIVIAL_RUN_SECONDS = 3;

/**
 * Hosts one game session: canvas viewport, input, loop, pause/resume, touch controls and the
 * hand-off to the meta-game when a run ends.
 */
export class PlayScreen {
  readonly el: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly viewport: Viewport;
  private readonly input = new Input();
  private readonly loop: GameLoop;
  private game: GameInstance | null = null;
  private ticket: RunTicket | null = null;
  private paused = false;
  private pauseModal: Modal | null = null;
  private resultsOpen = false;
  private destroyed = false;

  constructor(
    private readonly app: App,
    private readonly def: GameDefinition,
    private readonly initialBoosts: BoostId[],
  ) {
    this.fpsEl = h('span', { class: 'play__fps', attrs: { hidden: !app.settings.showFps } });
    this.muteBtn = h('button', {
      class: 'icon-btn',
      attrs: { type: 'button', 'aria-label': 'Toggle sound' },
      on: { click: () => this.toggleMute() },
    });
    this.renderMuteIcon();
    const header = h(
      'div',
      { class: 'play__header' },
      h(
        'button',
        {
          class: 'icon-btn',
          attrs: { type: 'button', 'aria-label': 'Pause' },
          on: { click: () => this.pause() },
        },
        icon('pause'),
      ),
      h('h1', { class: 'play__title', text: def.title }),
      this.fpsEl,
      this.muteBtn,
      document.fullscreenEnabled
        ? h(
            'button',
            {
              class: 'icon-btn',
              attrs: { type: 'button', 'aria-label': 'Toggle fullscreen' },
              on: { click: () => this.toggleFullscreen() },
            },
            icon('expand'),
          )
        : null,
    );
    this.stage = h(
      'div',
      { class: 'play__stage' },
      h(
        'div',
        { class: 'rotate-hint', attrs: { 'aria-hidden': 'true' } },
        'Rotate your device for a bigger view',
      ),
    );
    this.el = h(
      'section',
      {
        class: `play play--${def.width > def.height ? 'landscape' : 'portrait'}`,
        attrs: { 'aria-label': def.title },
      },
      header,
      this.stage,
    );
    this.el.style.setProperty('--accent', def.accent);
    this.viewport = new Viewport(this.stage, def.width, def.height);
    this.viewport.canvas.setAttribute('aria-label', `${def.title} game canvas`);
    if (def.id === 'duck') this.viewport.canvas.classList.add('no-cursor');
    this.buildTouchControls();
    this.loop = new GameLoop(
      (dt) => this.step(dt),
      () => this.draw(),
    );
  }

  start(): void {
    this.input.attach(this.stage, this.viewport.toLogical);
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    this.viewport.fit();
    this.newRun(this.initialBoosts);
    this.viewport.canvas.focus({ preventScroll: true });
  }

  private newRun(boosts: BoostId[]): void {
    this.ticket = this.app.arcade.startRun(this.def.id, boosts);
    this.game?.destroy();
    this.input.reset();
    this.game = this.def.create({
      ctx: this.viewport.ctx,
      width: this.def.width,
      height: this.def.height,
      input: this.input,
      audio: this.app.audio,
      rng: new Rng((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0),
      loadout: this.ticket.loadout,
      reducedMotion: this.app.reducedMotion,
      haptic: (ms) => this.app.haptic(ms),
    });
    if (this.ticket.boosts.length > 0) {
      this.app.toaster.show({
        title: 'Boosts active',
        body: this.ticket.boosts.map((b) => b.replace('-', ' ')).join(' · '),
        icon: 'bolt',
        tone: 'info',
        ms: 2500,
      });
    }
    this.paused = false;
    this.input.setEnabled(true);
    this.app.audio.startMusic(this.def.music);
    this.loop.start();
  }

  private step(dt: number): void {
    const game = this.game;
    if (!game) return;
    game.update(dt);
    if (this.input.wasPressed('pause')) {
      this.input.postUpdate();
      this.pause();
      return;
    }
    this.input.postUpdate();
    if (game.isOver()) this.finish();
  }

  private draw(): void {
    this.input.pollGamepads();
    if (!this.game) return;
    this.viewport.begin();
    this.game.render();
    if (!this.fpsEl.hidden) this.fpsEl.textContent = `${this.loop.fps} fps`;
  }

  // ------------------------------------------------------------------ run end

  /** Record the current run with the arcade. Returns null for trivial (instantly quit) runs. */
  private settle(): RunSummary | null {
    if (!this.ticket || !this.game) return null;
    const ticket = this.ticket;
    this.ticket = null;
    const result: GameResult = this.game.getResult();
    if (result.durationSec < TRIVIAL_RUN_SECONDS && result.score === 0) {
      this.app.arcade.abandonRun(ticket);
      return null;
    }
    return this.app.arcade.finishRun(ticket, result);
  }

  private finish(): void {
    this.loop.stop();
    this.input.setEnabled(false);
    this.app.audio.stopMusic();
    const summary = this.settle();
    if (!summary) {
      this.app.navigate('');
      return;
    }
    this.resultsOpen = true;
    showResults(this.app, this.def, summary, {
      playAgain: () => {
        this.resultsOpen = false;
        this.newRun([]);
      },
      changeLoadout: () => {
        this.resultsOpen = false;
        this.app.returnToLobby(this.def.id);
      },
      exit: () => {
        this.resultsOpen = false;
        this.app.navigate('');
      },
    });
  }

  // ------------------------------------------------------------------ pause

  pause(): void {
    if (this.paused || this.resultsOpen || !this.game || this.destroyed) return;
    this.paused = true;
    this.loop.stop();
    this.input.setEnabled(false);
    this.app.audio.setMusicPaused(true);
    const modal = new Modal(this.app.overlayHost, {
      title: 'Paused',
      className: 'modal--small modal--pause',
      onDismiss: () => this.resume(),
    });
    this.pauseModal = modal;
    const btn = (label: string, cls: string, iconName: Parameters<typeof icon>[0], fn: () => void) =>
      h(
        'button',
        { class: `btn ${cls}`, attrs: { type: 'button' }, on: { click: fn } },
        icon(iconName),
        label,
      );
    const result = this.game.getResult();
    modal.body.append(
      h(
        'p',
        { class: 'pause__score' },
        h('span', { class: 'muted', text: 'Score ' }),
        h('strong', { text: fmt(result.score) }),
        h('span', { class: 'muted', text: ` · ${fmt(result.coins)} coins` }),
      ),
      h(
        'div',
        { class: 'pause__actions' },
        btn('Resume', 'btn--primary', 'play', () => this.resume()),
        btn('Restart', 'btn--ghost', 'restart', () => this.restart()),
        btn('End run', 'btn--ghost', 'flag', () => {
          this.closePauseModal();
          this.finish();
        }),
      ),
      h('p', {
        class: 'muted small',
        text: 'Ending or restarting still banks the coins and XP you earned so far.',
      }),
    );
  }

  private closePauseModal(): void {
    const m = this.pauseModal;
    this.pauseModal = null;
    m?.close();
  }

  resume(): void {
    if (!this.paused || this.destroyed) return;
    this.closePauseModal();
    this.paused = false;
    this.input.setEnabled(true);
    this.app.audio.setMusicPaused(false);
    this.loop.start();
    this.viewport.canvas.focus({ preventScroll: true });
  }

  private restart(): void {
    this.closePauseModal();
    const summary = this.settle();
    if (summary && (summary.rewards.coins > 0 || summary.rewards.xp > 0)) {
      this.app.toaster.show({
        title: 'Run banked',
        body: `+${fmt(summary.rewards.coins)} coins · +${fmt(summary.rewards.xp)} XP`,
        icon: 'coin',
        tone: 'gold',
        ms: 2500,
      });
    }
    this.newRun([]);
  }

  // ------------------------------------------------------------------ controls & system events

  private buildTouchControls(): void {
    const mode = this.app.settings.touchControls;
    const show = mode === 'on' || (mode === 'auto' && isTouchDevice());
    if (!show || this.def.touchButtons.length === 0) return;
    const wrap = h('div', { class: 'touch-controls', attrs: { 'aria-hidden': 'true' } });
    const left = h('div', { class: 'touch-controls__side touch-controls__side--left' });
    const right = h('div', { class: 'touch-controls__side touch-controls__side--right' });
    for (const b of this.def.touchButtons) {
      const id = `${b.action}-${b.side}-${b.slot ?? 0}`;
      const el = h('button', {
        class: `touch-btn ${b.wide ? 'touch-btn--wide' : ''}`,
        text: b.label,
        attrs: { type: 'button', tabindex: '-1' },
      });
      const down = (e: PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        el.classList.add('is-down');
        this.input.setVirtual(b.action, true, id);
      };
      const up = (e: PointerEvent) => {
        e.stopPropagation();
        el.classList.remove('is-down');
        this.input.setVirtual(b.action, false, id);
      };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      (b.side === 'left' ? left : right).appendChild(el);
    }
    wrap.append(left, right);
    this.stage.appendChild(wrap);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape' && e.code !== 'KeyP' && e.code !== 'KeyM') return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyM') {
      this.toggleMute();
      return;
    }
    if (this.resultsOpen) return;
    if (this.paused) {
      // Escape is handled by the modal itself (dismiss → resume).
      if (e.code === 'KeyP') this.resume();
    } else {
      e.preventDefault();
      this.pause();
    }
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) this.pause();
  };

  private readonly onBlur = (): void => {
    this.pause();
  };

  private toggleMute(): void {
    this.app.updateSettings({ muted: !this.app.settings.muted });
    this.renderMuteIcon();
  }

  private renderMuteIcon(): void {
    this.muteBtn.replaceChildren(icon(this.app.settings.muted ? 'mute' : 'volume'));
    this.muteBtn.setAttribute('aria-pressed', this.app.settings.muted ? 'true' : 'false');
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void this.el.requestFullscreen?.().catch(() => undefined);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    this.closePauseModal();
    // Leaving mid-run (e.g. browser back) still banks progress.
    const summary = this.resultsOpen ? null : this.settle();
    if (summary && summary.rewards.coins + summary.rewards.xp > 0) {
      this.app.toaster.show({
        title: 'Run banked',
        body: `+${fmt(summary.rewards.coins)} coins · +${fmt(summary.rewards.xp)} XP`,
        icon: 'coin',
        tone: 'gold',
        ms: 2500,
      });
    }
    this.game?.destroy();
    this.game = null;
    this.input.detach();
    this.viewport.destroy();
    this.app.audio.stopMusic();
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }
}
