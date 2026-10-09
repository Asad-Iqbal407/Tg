/** Abstract actions. `pause` comes from gamepads only; the play screen handles Escape/P itself. */
export type Action = 'left' | 'right' | 'up' | 'down' | 'primary' | 'secondary' | 'pause';
export type SwipeDir = 'left' | 'right' | 'up' | 'down';

const KEYMAP: Readonly<Record<string, readonly Action[]>> = {
  ArrowLeft: ['left'],
  KeyA: ['left'],
  ArrowRight: ['right'],
  KeyD: ['right'],
  ArrowUp: ['up'],
  KeyW: ['up'],
  ArrowDown: ['down'],
  KeyS: ['down'],
  Space: ['primary'],
  Enter: ['primary'],
  KeyJ: ['primary'],
  KeyZ: ['primary'],
  ShiftLeft: ['secondary'],
  ShiftRight: ['secondary'],
  KeyX: ['secondary'],
  KeyK: ['secondary'],
  KeyB: ['secondary'],
};

/** Keys whose default browser behaviour (scrolling, button activation) we suppress while a game is attached. */
const PREVENT_DEFAULT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter']);

const SWIPE_MIN_PX = 28;
const SWIPE_MAX_MS = 600;
const GAMEPAD_DEADZONE = 0.35;

export interface PointerState {
  x: number;
  y: number;
  down: boolean;
  /** True for one update step after the pointer went down. */
  pressed: boolean;
  released: boolean;
  /** True when the most recent pointer interaction came from touch. */
  touch: boolean;
  /** True once the pointer has been used over the game surface. */
  active: boolean;
}

type CoordMapper = (clientX: number, clientY: number) => { x: number; y: number };

/**
 * Unified input: keyboard, pointer (mouse/touch/pen with swipe detection), gamepads and
 * on-screen virtual buttons, all mapped onto a small set of abstract actions.
 *
 * Edge states (pressed/released, swipes) persist until `postUpdate()` is called, which the
 * game loop does after each fixed simulation step so no input is lost at high refresh rates.
 */
export class Input {
  readonly pointer: PointerState = {
    x: 0,
    y: 0,
    down: false,
    pressed: false,
    released: false,
    touch: false,
    active: false,
  };

  private readonly holders = new Map<Action, Set<string>>();
  private readonly pressedSet = new Set<Action>();
  private readonly releasedSet = new Set<Action>();
  private readonly heldKeys = new Set<string>();
  private swipes: SwipeDir[] = [];
  private swipeStart: { x: number; y: number; t: number; id: number; fired: boolean } | null = null;
  private target: HTMLElement | null = null;
  private mapper: CoordMapper = (x, y) => ({ x, y });
  private enabled = true;

  attach(target: HTMLElement, mapper: CoordMapper): void {
    this.detach();
    this.target = target;
    this.mapper = mapper;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    if (this.target) {
      this.target.removeEventListener('pointerdown', this.onPointerDown);
      this.target.removeEventListener('contextmenu', this.onContextMenu);
    }
    this.target = null;
    this.reset();
  }

  /** Disabled input ignores new events (e.g. while a pause menu is open) but keeps listeners. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  isDown(action: Action): boolean {
    const set = this.holders.get(action);
    return !!set && set.size > 0;
  }

  wasPressed(action: Action): boolean {
    return this.pressedSet.has(action);
  }

  wasReleased(action: Action): boolean {
    return this.releasedSet.has(action);
  }

  /** Horizontal axis in [-1, 1] from left/right actions. */
  axisX(): number {
    return (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
  }

  axisY(): number {
    return (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0);
  }

  consumeSwipe(): SwipeDir | null {
    return this.swipes.shift() ?? null;
  }

  /** Programmatic press used by on-screen buttons. `source` distinguishes simultaneous holders. */
  setVirtual(action: Action, down: boolean, source = 'virtual'): void {
    if (!this.enabled && down) return;
    if (down) this.press(action, `v:${source}`);
    else this.release(action, `v:${source}`);
  }

  /** Inject a synthetic swipe (used by tests and on-screen controls). */
  pushSwipe(dir: SwipeDir): void {
    if (this.enabled) this.swipes.push(dir);
  }

  /** Poll connected gamepads; call once per rendered frame. */
  pollGamepads(): void {
    if (!this.enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    let pads: (Gamepad | null)[];
    try {
      pads = Array.from(navigator.getGamepads());
    } catch {
      return;
    }
    const want = new Map<Action, boolean>([
      ['left', false],
      ['right', false],
      ['up', false],
      ['down', false],
      ['primary', false],
      ['secondary', false],
      ['pause', false],
    ]);
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (b(14) || ax < -GAMEPAD_DEADZONE) want.set('left', true);
      if (b(15) || ax > GAMEPAD_DEADZONE) want.set('right', true);
      if (b(12) || ay < -GAMEPAD_DEADZONE) want.set('up', true);
      if (b(13) || ay > GAMEPAD_DEADZONE) want.set('down', true);
      if (b(0) || b(7)) want.set('primary', true);
      if (b(1) || b(2) || b(6)) want.set('secondary', true);
      if (b(9)) want.set('pause', true);
    }
    for (const [action, down] of want) {
      if (down) this.press(action, 'pad');
      else this.release(action, 'pad');
    }
  }

  /** Clear edge-triggered state; called after each simulation step. */
  postUpdate(): void {
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.pointer.pressed = false;
    this.pointer.released = false;
    this.swipes.length = 0;
  }

  reset(): void {
    this.holders.clear();
    this.heldKeys.clear();
    this.pressedSet.clear();
    this.releasedSet.clear();
    this.swipes.length = 0;
    this.swipeStart = null;
    this.pointer.down = false;
    this.pointer.pressed = false;
    this.pointer.released = false;
  }

  private press(action: Action, source: string): void {
    let set = this.holders.get(action);
    if (!set) {
      set = new Set();
      this.holders.set(action, set);
    }
    if (set.has(source)) return;
    if (set.size === 0) this.pressedSet.add(action);
    set.add(source);
  }

  private release(action: Action, source: string): void {
    const set = this.holders.get(action);
    if (!set || !set.has(source)) return;
    set.delete(source);
    if (set.size === 0) this.releasedSet.add(action);
  }

  private isTypingTarget(e: Event): boolean {
    const el = e.target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return (
      el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
    );
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.isTypingTarget(e)) return;
    const actions = KEYMAP[e.code];
    if (!actions) return;
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (!this.enabled) return;
    if (this.heldKeys.has(e.code)) return;
    this.heldKeys.add(e.code);
    for (const a of actions) this.press(a, `k:${e.code}`);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const actions = KEYMAP[e.code];
    if (!actions) return;
    this.heldKeys.delete(e.code);
    for (const a of actions) this.release(a, `k:${e.code}`);
  };

  private readonly onBlur = (): void => {
    this.reset();
  };

  private readonly onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = this.mapper(e.clientX, e.clientY);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    this.pointer.down = true;
    this.pointer.pressed = true;
    this.pointer.touch = e.pointerType !== 'mouse';
    this.pointer.active = true;
    this.swipeStart = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId, fired: false };
    try {
      this.target?.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.target) return;
    const p = this.mapper(e.clientX, e.clientY);
    this.pointer.x = p.x;
    this.pointer.y = p.y;
    if (e.pointerType === 'mouse') this.pointer.active = true;
    const s = this.swipeStart;
    if (s && !s.fired && s.id === e.pointerId) {
      const dir = this.detectSwipe(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t);
      if (dir) {
        s.fired = true;
        if (this.enabled) this.swipes.push(dir);
      }
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.target) return;
    const s = this.swipeStart;
    if (s && s.id === e.pointerId) {
      if (!s.fired) {
        const dir = this.detectSwipe(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t);
        if (dir && this.enabled) this.swipes.push(dir);
      }
      this.swipeStart = null;
    }
    if (this.pointer.down) {
      this.pointer.down = false;
      this.pointer.released = true;
    }
  };

  private detectSwipe(dx: number, dy: number, ms: number): SwipeDir | null {
    if (ms > SWIPE_MAX_MS) return null;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < SWIPE_MIN_PX) return null;
    if (ax > ay) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }
}
