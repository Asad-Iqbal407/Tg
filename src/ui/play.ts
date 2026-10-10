import { chooseLogicalSize, fittedArea, GameLoop, type LogicalSize, Viewport } from '../core/engine';
import { type Action, Input } from '../core/input';
import { Rng } from '../core/rng';
import type { BoostId, GameDefinition, GameInstance, GameResult, Insets } from '../games/types';
import type { RunSummary, RunTicket } from '../meta/arcade';
import type { App } from './app';
import { fmt, h, isTouchDevice } from './dom';
import { icon, type IconName } from './icons';
import { Modal } from './overlay';
import { showResults } from './results';

/** Runs shorter than this with zero score are discarded instead of recorded. */
const TRIVIAL_RUN_SECONDS = 3;
/** Suggest rotating the device when that would make the game at least this much bigger (area). */
const ROTATE_GAIN = 1.5;
/** Offer "Restart to fit" in the pause menu when a fresh run would be this much bigger (area). */
const REFIT_GAIN = 1.1;
/** CSS px kept clear above touch buttons when reporting insets to the game. */
const INSET_MARGIN = 6;
/** How far (CSS px) a finger may slide off a touch button and still hold the nearest one. */
const SLIDE_REACH = 28;
/** Sustained frame rate below which the backing-store resolution is lowered. */
const LOW_FPS = 48;

interface TouchKey {
  el: HTMLElement;
  action: Action;
  id: string;
}

/**
 * Hosts one game session: canvas viewport, input, loop, pause/resume, touch controls and the
 * hand-off to the meta-game when a run ends. The logical size is picked once per run to fill
 * the stage; resizes and rotations only re-letterbox until the next run.
 */
export class PlayScreen {
  readonly el: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly fpsEl: HTMLElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly fullscreenBtn: HTMLButtonElement | null;
  private readonly rotateHint: HTMLButtonElement;
  private readonly viewport: Viewport;
  private readonly input = new Input();
  private readonly loop: GameLoop;
  private touchWrap: HTMLElement | null = null;
  private readonly touchKeys: TouchKey[] = [];
  private readonly touchResets: (() => void)[] = [];
  private game: GameInstance | null = null;
  private ticket: RunTicket | null = null;
  private runSize: LogicalSize;
  /** Live insets object handed to the current game; updated in place on layout changes. */
  private insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  private paused = false;
  private pauseModal: Modal | null = null;
  private fitBtn: HTMLButtonElement | null = null;
  private resultsOpen = false;
  private destroyed = false;
  private stageLandscape: boolean | null = null;
  private sawTouch = isTouchDevice();
  /** Rotate prompt dismissed, per stage orientation. */
  private readonly rotateDismissed = { landscape: false, portrait: false };
  private menuRaf = 0;
  private shownFps = -1;
  private slowTime = 0;

  constructor(
    private readonly app: App,
    private readonly def: GameDefinition,
    private readonly initialBoosts: BoostId[],
  ) {
    this.runSize = { width: def.width, height: def.height };
    this.fpsEl = h('span', { class: 'play__fps', attrs: { hidden: !app.settings.showFps } });
    this.muteBtn = this.headerButton('Toggle sound', 'volume', () => this.toggleMute());
    this.renderMuteIcon();
    this.fullscreenBtn = document.fullscreenEnabled
      ? this.headerButton('Toggle fullscreen', 'expand', () => this.toggleFullscreen())
      : null;
    this.fullscreenBtn?.setAttribute('aria-pressed', 'false');
    const header = h(
      'div',
      { class: 'play__header' },
      this.headerButton('Pause', 'pause', () => this.pause()),
      h('h1', { class: 'play__title', text: def.title }),
      this.fpsEl,
      this.muteBtn,
      this.fullscreenBtn,
    );
    this.rotateHint = h(
      'button',
      {
        class: 'rotate-hint',
        attrs: { type: 'button', 'aria-label': 'Rotate your device for a bigger view. Tap to dismiss.' },
        on: {
          pointerdown: (e) => e.stopPropagation(),
          click: () => this.dismissRotateHint(),
        },
      },
      icon('rotate', 'icon rotate-hint__icon'),
      h('span', { class: 'rotate-hint__text', text: 'Rotate for a bigger view' }),
      icon('close', 'icon rotate-hint__close'),
    );
    this.stage = h('div', { class: 'play__stage' }, this.rotateHint);
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
    // Aim/steer games draw their own reticle or ship under the pointer.
    if (def.id === 'duck' || def.id === 'galaxy') this.viewport.canvas.classList.add('no-cursor');
    this.buildTouchControls();
    this.loop = new GameLoop(
      (dt) => this.step(dt),
      (frameDt) => this.draw(frameDt),
      { poll: () => this.input.pollGamepads() },
    );
  }

  start(): void {
    this.input.attach(this.stage, this.viewport.toLogical, { pointerArea: this.def.pointerArea ?? 'canvas' });
    window.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('gamepadconnected', this.onGamepadConnected);
    this.viewport.onRefit = this.onRefit;
    this.viewport.fit();
    this.newRun(this.initialBoosts);
    this.viewport.canvas.focus({ preventScroll: true });
  }

  private newRun(boosts: BoostId[]): void {
    this.stopMenuPad();
    this.ticket = this.app.arcade.startRun(this.def.id, boosts);
    this.game?.destroy();
    this.game = null;
    this.app.audio.stopEngines();
    this.input.reset();
    // Pick the logical size for this run from the space available right now.
    const avail = this.viewport.available();
    const size = chooseLogicalSize(this.def, avail.width, avail.height);
    this.runSize = size;
    this.stageLandscape = avail.width > avail.height;
    this.el.classList.toggle('play--landscape', size.width > size.height);
    this.el.classList.toggle('play--portrait', size.width <= size.height);
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.viewport.setLogicalSize(size.width, size.height);
    this.updateLayout();
    this.game = this.def.create({
      ctx: this.viewport.ctx,
      width: size.width,
      height: size.height,
      input: this.input,
      audio: this.app.audio,
      rng: new Rng((Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0),
      loadout: this.ticket.loadout,
      insets: this.insets,
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
    this.app.audio.setPaused(false);
    this.app.audio.setMusicPaused(false);
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

  private draw(frameDt: number): void {
    if (!this.game) return;
    this.viewport.begin();
    this.game.render();
    if (!this.fpsEl.hidden && this.loop.fps !== this.shownFps) {
      this.shownFps = this.loop.fps;
      this.fpsEl.textContent = `${this.loop.fps} fps`;
    }
    this.adaptQuality(frameDt);
  }

  /** Repaint the current frame without simulating (paused, results, or after a resize). */
  private redraw(): void {
    if (!this.game || this.destroyed) return;
    this.viewport.begin();
    this.game.render();
  }

  /**
   * If the device can't keep up, lower the backing-store resolution a step at a time (never below
   * one backing pixel per logical pixel). Raster/composite cost, not script, dominates on big screens.
   */
  private adaptQuality(frameDt: number): void {
    const fps = this.loop.fps;
    if (fps === 0 || fps >= LOW_FPS || this.viewport.renderScale <= 1) {
      this.slowTime = 0;
      return;
    }
    this.slowTime += frameDt;
    if (this.slowTime < 2) return;
    this.slowTime = 0;
    this.viewport.maxScale = Math.max(1, this.viewport.renderScale - 0.25);
    this.viewport.fit();
  }

  // ------------------------------------------------------------------ layout

  private readonly onRefit = (): void => {
    if (this.destroyed) return;
    const a = this.viewport.available();
    const landscape = a.width > a.height;
    const rotated = this.stageLandscape !== null && landscape !== this.stageLandscape;
    this.stageLandscape = landscape;
    this.updateLayout();
    // A rotation mid-run reshuffles everything: stop and let the player choose.
    if (rotated) this.pause();
    if (this.paused) this.updateFitOffer();
    if (this.loop.isRunning) this.loop.invalidate();
    else this.redraw();
  };

  private updateLayout(): void {
    this.updateInsets();
    this.updateRotateHint();
  }

  /** Report the part of the canvas covered by touch buttons, in logical px. */
  private updateInsets(): void {
    const ins = this.insets;
    let bottom = 0;
    if (this.touchWrap && !this.touchWrap.hidden) {
      const c = this.viewport.canvas.getBoundingClientRect();
      if (c.width > 0 && c.height > 0) {
        for (const k of this.touchKeys) {
          const r = k.el.getBoundingClientRect();
          if (r.right <= c.left || r.left >= c.right || r.bottom <= c.top || r.top >= c.bottom) continue;
          bottom = Math.max(bottom, c.bottom - r.top + INSET_MARGIN);
        }
        bottom = Math.min(bottom, c.height / 2) * (this.viewport.height / c.height);
      }
    }
    ins.top = 0;
    ins.right = 0;
    ins.left = 0;
    ins.bottom = Math.ceil(bottom);
  }

  /** How much bigger (by area) the game would be after rotating the device and restarting. */
  private rotateGain(): number {
    const a = this.viewport.available();
    const now = fittedArea(this.runSize, a.width, a.height);
    if (now <= 0) return 1;
    const turned = chooseLogicalSize(this.def, a.height, a.width);
    return fittedArea(turned, a.height, a.width) / now;
  }

  /** How much bigger (by area) a fresh run would be on the current screen. */
  private refitGain(): number {
    const a = this.viewport.available();
    const now = fittedArea(this.runSize, a.width, a.height);
    if (now <= 0) return 1;
    return fittedArea(chooseLogicalSize(this.def, a.width, a.height), a.width, a.height) / now;
  }

  private updateRotateHint(): void {
    const hint = this.rotateHint;
    const a = this.viewport.available();
    const key = a.width > a.height ? 'landscape' : 'portrait';
    const show = this.sawTouch && !this.rotateDismissed[key] && this.rotateGain() >= ROTATE_GAIN;
    hint.classList.toggle('is-visible', show);
    if (show) this.placeRotateHint();
  }

  /** Put the rotate prompt in the widest letterbox band so it doesn't cover the game. */
  private placeRotateHint(): void {
    const s = this.stage.getBoundingClientRect();
    const c = this.viewport.canvas.getBoundingClientRect();
    const top = c.top - s.top;
    const side = c.left - s.left;
    const hint = this.rotateHint;
    hint.classList.remove('rotate-hint--side');
    if (top >= 64 || top >= side) {
      hint.style.left = `${s.width / 2}px`;
      hint.style.top = `${Math.max(top / 2, 32)}px`;
      hint.style.maxWidth = `${Math.max(160, s.width - 24)}px`;
    } else {
      hint.classList.add('rotate-hint--side');
      hint.style.left = `${side / 2}px`;
      hint.style.top = `${s.height / 2}px`;
      hint.style.maxWidth = `${Math.max(96, side - 16)}px`;
    }
  }

  private dismissRotateHint(): void {
    const a = this.viewport.available();
    this.rotateDismissed[a.width > a.height ? 'landscape' : 'portrait'] = true;
    this.updateRotateHint();
    this.viewport.canvas.focus({ preventScroll: true });
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
    this.paused = false;
    this.input.setEnabled(false);
    this.releaseTouches();
    this.app.audio.stopMusic();
    // The run is over: silence engine drones before the results (and their sounds) appear.
    this.app.audio.stopEngines();
    this.app.audio.setPaused(false);
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
    this.startMenuPad();
  }

  // ------------------------------------------------------------------ pause

  pause(): void {
    if (this.paused || this.resultsOpen || !this.game || this.destroyed) return;
    this.paused = true;
    this.loop.stop();
    this.input.setEnabled(false);
    this.releaseTouches();
    this.app.audio.setMusicPaused(true);
    this.app.audio.setPaused(true);
    this.redraw();
    const modal = new Modal(this.app.overlayHost, {
      title: 'Paused',
      className: 'modal--small modal--pause',
      onDismiss: () => this.resume(),
    });
    this.pauseModal = modal;
    const btn = (label: string, cls: string, iconName: IconName, fn: () => void) =>
      h(
        'button',
        { class: `btn ${cls}`, attrs: { type: 'button' }, on: { click: fn } },
        icon(iconName),
        label,
      );
    const result = this.game.getResult();
    this.fitBtn = btn('Restart to fit this screen', 'btn--ghost', 'expand', () => this.restart());
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
        this.fitBtn,
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
    this.updateFitOffer();
    this.startMenuPad();
  }

  /** Show "Restart to fit" only when the screen changed enough since the run started. */
  private updateFitOffer(): void {
    if (this.fitBtn) this.fitBtn.hidden = this.refitGain() < REFIT_GAIN;
  }

  private closePauseModal(): void {
    const m = this.pauseModal;
    this.pauseModal = null;
    this.fitBtn = null;
    m?.close();
  }

  resume(): void {
    if (!this.paused || this.destroyed) return;
    this.closePauseModal();
    this.stopMenuPad();
    this.paused = false;
    this.input.setEnabled(true);
    this.app.audio.setMusicPaused(false);
    this.app.audio.setPaused(false);
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

  // ------------------------------------------------------------------ gamepad menus

  /** While a menu is open the game loop is stopped, so poll pads for menu navigation here. */
  private startMenuPad(): void {
    if (this.menuRaf || this.destroyed || !this.hasGamepad()) return;
    this.input.primePadMenu();
    const tick = () => {
      this.menuRaf = requestAnimationFrame(tick);
      const e = this.input.pollPadMenu();
      if (!e) return;
      const modal = this.app.overlayHost.querySelector<HTMLElement>('.modal-backdrop:last-child .modal');
      if (this.paused && (e.start || e.back)) {
        this.resume();
        return;
      }
      if (!modal) return;
      const buttons = Array.from(modal.querySelectorAll<HTMLButtonElement>('button:not([disabled])')).filter(
        (b) => b.offsetParent !== null && !b.classList.contains('modal__close'),
      );
      const n = buttons.length;
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (e.confirm || e.start) (buttons[i] ?? buttons[0])?.click();
      else if ((e.next || e.prev) && n > 0) buttons[i < 0 ? 0 : (i + (e.next ? 1 : n - 1)) % n]?.focus();
    };
    this.menuRaf = requestAnimationFrame(tick);
  }

  private stopMenuPad(): void {
    if (this.menuRaf) cancelAnimationFrame(this.menuRaf);
    this.menuRaf = 0;
  }

  private hasGamepad(): boolean {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return false;
    try {
      return Array.from(navigator.getGamepads()).some((p) => p?.connected);
    } catch {
      return false;
    }
  }

  private readonly onGamepadConnected = (): void => {
    if (this.paused || this.resultsOpen) this.startMenuPad();
  };

  // ------------------------------------------------------------------ controls & system events

  private headerButton(label: string, iconName: IconName, onClick: () => void): HTMLButtonElement {
    return h(
      'button',
      {
        class: 'icon-btn',
        attrs: { type: 'button', 'aria-label': label },
        on: {
          // Keep keyboard focus on the game when clicked, so Space/Enter keep playing.
          mousedown: (e) => e.preventDefault(),
          click: onClick,
        },
      },
      icon(iconName),
    );
  }

  private buildTouchControls(): void {
    const mode = this.app.settings.touchControls;
    if (mode === 'off' || this.def.touchButtons.length === 0) return;
    const wrap = h('div', { class: 'touch-controls', attrs: { 'aria-hidden': 'true' } });
    const sides = {
      left: h('div', { class: 'touch-controls__side touch-controls__side--left' }),
      right: h('div', { class: 'touch-controls__side touch-controls__side--right' }),
    };
    const bySide: Record<'left' | 'right', TouchKey[]> = { left: [], right: [] };
    for (const b of this.def.touchButtons) {
      const el = h('button', {
        class: `touch-btn ${b.wide ? 'touch-btn--wide' : ''}`,
        text: b.label,
        attrs: { type: 'button', tabindex: '-1' },
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      const key: TouchKey = { el, action: b.action, id: `${b.action}-${b.side}-${b.slot ?? 0}` };
      bySide[b.side].push(key);
      this.touchKeys.push(key);
      sides[b.side].appendChild(el);
    }
    this.bindTouchSide(sides.left, bySide.left);
    this.bindTouchSide(sides.right, bySide.right);
    wrap.append(sides.left, sides.right);
    this.touchWrap = wrap;
    // 'auto' on a device without a coarse pointer (e.g. a touch laptop): show on the first touch.
    wrap.hidden = !(mode === 'on' || isTouchDevice());
    if (wrap.hidden) this.stage.addEventListener('pointerdown', this.onFirstTouch, true);
    this.stage.appendChild(wrap);
  }

  private readonly onFirstTouch = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.stage.removeEventListener('pointerdown', this.onFirstTouch, true);
    this.sawTouch = true;
    if (this.touchWrap) this.touchWrap.hidden = false;
    this.updateLayout();
  };

  /**
   * One side of the on-screen pad. Each finger holds the button nearest to it, so a thumb can
   * slide between buttons (◀ to ▶, B to A) without lifting. Button fingers never reach the game
   * pointer: their events stop here, before the stage and window listeners.
   */
  private bindTouchSide(side: HTMLElement, keys: TouchKey[]): void {
    if (keys.length === 0) return;
    const fingers = new Map<number, TouchKey | null>();
    let rects: DOMRect[] = [];
    const nearest = (x: number, y: number): TouchKey | null => {
      let best: TouchKey | null = null;
      let bestD = SLIDE_REACH;
      keys.forEach((k, i) => {
        const r = rects[i];
        if (!r) return;
        const dx = Math.max(r.left - x, 0, x - r.right);
        const dy = Math.max(r.top - y, 0, y - r.bottom);
        const d = Math.hypot(dx, dy);
        if (d <= bestD) {
          best = k;
          bestD = d;
        }
      });
      return best;
    };
    const hold = (pointerId: number, key: TouchKey | null) => {
      const prev = fingers.get(pointerId) ?? null;
      if (prev === key) return;
      fingers.set(pointerId, key);
      if (prev) this.input.setVirtual(prev.action, false, `${prev.id}#${pointerId}`);
      if (key) this.input.setVirtual(key.action, true, `${key.id}#${pointerId}`);
      const held = new Set(fingers.values());
      for (const k of keys) k.el.classList.toggle('is-down', held.has(k));
    };
    const lift = (e: PointerEvent) => {
      if (!fingers.has(e.pointerId)) return;
      e.stopPropagation();
      hold(e.pointerId, null);
      fingers.delete(e.pointerId);
    };
    side.addEventListener('pointerdown', (e) => {
      const key = keys.find((k) => k.el === e.target || k.el.contains(e.target as Node));
      if (!key) return;
      e.preventDefault();
      e.stopPropagation();
      this.sawTouch ||= e.pointerType === 'touch';
      rects = keys.map((k) => k.el.getBoundingClientRect());
      try {
        key.el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      hold(e.pointerId, key);
    });
    side.addEventListener('pointermove', (e) => {
      if (!fingers.has(e.pointerId)) return;
      e.stopPropagation();
      hold(e.pointerId, nearest(e.clientX, e.clientY));
    });
    side.addEventListener('pointerup', lift);
    side.addEventListener('pointercancel', lift);
    side.addEventListener('lostpointercapture', lift);
    this.touchResets.push(() => {
      for (const id of [...fingers.keys()]) hold(id, null);
      fingers.clear();
    });
  }

  /** Drop every on-screen button press (pausing or ending must not leave a button stuck). */
  private releaseTouches(): void {
    for (const reset of this.touchResets) reset();
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

  /**
   * Fullscreen the whole document (not just the play section) so the pause menu, results and
   * toasts, which live outside it, stay visible.
   */
  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const root = document.documentElement;
    if (!root.requestFullscreen) return;
    void root
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => this.lockOrientation())
      .catch(() => undefined);
  }

  /** On phones and tablets, keep the screen in the orientation the current run was sized for. */
  private lockOrientation(): void {
    if (!isTouchDevice()) return;
    const o = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    const want = this.runSize.width > this.runSize.height ? 'landscape' : 'portrait';
    void o?.lock?.(want).catch(() => undefined);
  }

  private readonly onFullscreenChange = (): void => {
    const on = !!document.fullscreenElement;
    const btn = this.fullscreenBtn;
    if (btn) {
      btn.replaceChildren(icon(on ? 'collapse' : 'expand'));
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
    }
    if (on) return;
    screen.orientation?.unlock?.();
    // Browsers swallow the Escape that leaves fullscreen; treat it like Escape in the game.
    this.pause();
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loop.stop();
    this.stopMenuPad();
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
    this.releaseTouches();
    this.game?.destroy();
    this.game = null;
    this.input.detach();
    this.viewport.destroy();
    this.app.audio.stopMusic();
    this.app.audio.stopEngines();
    this.app.audio.setPaused(false);
    this.app.audio.setMusicPaused(false);
    window.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('gamepadconnected', this.onGamepadConnected);
    this.stage.removeEventListener('pointerdown', this.onFirstTouch, true);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }
}
