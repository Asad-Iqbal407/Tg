/**
 * Abstract actions. `tertiary` is a third game button (Q, LB). `pause` comes from gamepads only; the play
 * screen handles Escape/P itself.
 */
export type Action = 'left' | 'right' | 'up' | 'down' | 'primary' | 'secondary' | 'tertiary' | 'pause';
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
  KeyQ: ['tertiary'],
};

/** Keys whose default browser behaviour (scrolling, button activation) we suppress while a game is attached. */
const PREVENT_DEFAULT = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter']);
/** Keys that activate a focused button or link; they belong to that element, not to the game. */
const ACTIVATION_KEYS = new Set(['Space', 'Enter', 'NumpadEnter']);
/** Focusable controls outside the game surface that handle their own keys. */
const INTERACTIVE =
  'button, a[href], summary, [role="button"], [role="link"], [role="menuitem"], [role="radio"], [role="checkbox"], [role="tab"], [role="dialog"]';

const SWIPE_MIN_PX = 28;
const SWIPE_MAX_MS = 600;
/** Stick dead zone for left/right. */
const STICK_DEADZONE_X = 0.35;
/** Larger vertical dead zone, so a stick pushed diagonally while running doesn't jump or duck. */
const STICK_DEADZONE_Y = 0.6;

export interface PointerState {
  /** Logical coordinates of the owned (primary) pointer, or of the hovering mouse. */
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
  /** True while (x, y) lies on the game canvas (0..W x 0..H). */
  inside: boolean;
}

/** Maps client (CSS) coordinates onto the game surface. `inside` defaults to true when omitted. */
export type CoordMapper = (clientX: number, clientY: number) => { x: number; y: number; inside?: boolean };

export interface AttachOptions {
  /**
   * Where presses and mouse moves count: only over the canvas (default), or anywhere on the
   * attach target (the play stage, letterbox bars included).
   */
  pointerArea?: 'canvas' | 'stage';
}

/** Edge-triggered gamepad buttons for navigating menus while the game itself is paused. */
export interface PadMenuEdges {
  start: boolean;
  confirm: boolean;
  back: boolean;
  next: boolean;
  prev: boolean;
}

const PAD_ACTIONS: readonly Action[] = [
  'left',
  'right',
  'up',
  'down',
  'primary',
  'secondary',
  'tertiary',
  'pause',
];

const MENU_START = 1;
const MENU_CONFIRM = 2;
const MENU_BACK = 4;
const MENU_NEXT = 8;
const MENU_PREV = 16;

/**
 * Unified input: keyboard, pointer (mouse/touch/pen with swipe detection), gamepads and
 * on-screen virtual buttons, all mapped onto a small set of abstract actions.
 *
 * The game pointer follows one *primary* pointer, owned by pointerId: the first finger (or the
 * mouse) that goes down on the game area. Other fingers never move or release it, and fingers
 * captured by on-screen buttons (which stop their pointerdown) are never adopted at all.
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
    inside: false,
  };

  private readonly holders = new Map<Action, Set<string>>();
  private readonly pressedSet = new Set<Action>();
  private readonly releasedSet = new Set<Action>();
  private readonly heldKeys = new Set<string>();
  private swipes: SwipeDir[] = [];
  private swipeStart: { x: number; y: number; t: number; id: number; fired: boolean } | null = null;
  private target: HTMLElement | null = null;
  private mapper: CoordMapper = (x, y) => ({ x, y });
  private area: 'canvas' | 'stage' = 'canvas';
  private enabled = true;
  /** pointerId that owns `pointer`, or null. */
  private primaryId: number | null = null;
  /** Other pointers that went down on the game area, kept to promote when the primary lifts. */
  private readonly others = new Map<number, { x: number; y: number; inside: boolean; touch: boolean }>();
  /** Pad actions held when input was (re-)enabled; ignored until released. */
  private readonly padLatched = new Set<Action>();
  /** Scratch state reused by `pollGamepads()` (it runs every animation frame). */
  private readonly padWant: Record<Action, boolean> = {
    left: false,
    right: false,
    up: false,
    down: false,
    primary: false,
    secondary: false,
    tertiary: false,
    pause: false,
  };
  private latchPad = false;
  private padMenuPrev = 0;

  attach(target: HTMLElement, mapper: CoordMapper, opts: AttachOptions = {}): void {
    this.detach();
    this.target = target;
    this.mapper = mapper;
    this.area = opts.pointerArea ?? 'canvas';
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerCancel);
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerCancel);
    if (this.target) {
      this.target.removeEventListener('pointerdown', this.onPointerDown);
      this.target.removeEventListener('contextmenu', this.onContextMenu);
    }
    this.target = null;
    this.reset();
  }

  /** Disabled input ignores new events (e.g. while a pause menu is open) but keeps listeners. */
  setEnabled(enabled: boolean): void {
    if (enabled && !this.enabled) this.latchPad = true;
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

  /** Poll connected gamepads; call once per animation frame. */
  pollGamepads(): void {
    if (!this.enabled) return;
    const pads = readPads();
    if (!pads) return;
    const want = this.padWant;
    for (const a of PAD_ACTIONS) want[a] = false;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      if (b(14) || ax < -STICK_DEADZONE_X) want.left = true;
      if (b(15) || ax > STICK_DEADZONE_X) want.right = true;
      if (b(12) || ay < -STICK_DEADZONE_Y) want.up = true;
      if (b(13) || ay > STICK_DEADZONE_Y) want.down = true;
      if (b(0) || b(7)) want.primary = true;
      if (b(1) || b(2) || b(6)) want.secondary = true;
      if (b(4)) want.tertiary = true;
      if (b(9)) want.pause = true;
    }
    const latch = this.latchPad;
    this.latchPad = false;
    for (const action of PAD_ACTIONS) {
      const down = want[action];
      // A button still held from a menu (e.g. A on "Resume") must not leak into the game.
      if (latch && down) this.padLatched.add(action);
      if (!down) this.padLatched.delete(action);
      if (down && !this.padLatched.has(action)) this.press(action, 'pad');
      else this.release(action, 'pad');
    }
  }

  /**
   * Gamepad buttons newly pressed since the last call, for menus shown while the game is paused.
   * Call `primePadMenu()` when a menu opens so buttons still held from gameplay don't fire.
   */
  pollPadMenu(): PadMenuEdges | null {
    const pads = readPads();
    if (!pads) return null;
    const now = padMenuMask(pads);
    const edges = now & ~this.padMenuPrev;
    this.padMenuPrev = now;
    if (edges === 0) return null;
    return {
      start: (edges & MENU_START) !== 0,
      confirm: (edges & MENU_CONFIRM) !== 0,
      back: (edges & MENU_BACK) !== 0,
      next: (edges & MENU_NEXT) !== 0,
      prev: (edges & MENU_PREV) !== 0,
    };
  }

  primePadMenu(): void {
    const pads = readPads();
    this.padMenuPrev = pads ? padMenuMask(pads) : 0;
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
    this.padLatched.clear();
    this.swipes.length = 0;
    this.swipeStart = null;
    this.primaryId = null;
    this.others.clear();
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

  /** A focused button, link or dialog outside the game surface owns Space/Enter. */
  private isInteractiveTarget(e: Event): boolean {
    const el = e.target as Element | null;
    if (!el || typeof el.closest !== 'function') return false;
    return el.closest(INTERACTIVE) !== null;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled || this.isTypingTarget(e)) return;
    if (ACTIVATION_KEYS.has(e.code) && this.isInteractiveTarget(e)) return;
    const actions = KEYMAP[e.code];
    if (!actions) return;
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
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

  /** Map a client point; `inArea` says whether it counts for the game under the pointer area. */
  private locate(
    clientX: number,
    clientY: number,
  ): { x: number; y: number; inside: boolean; inArea: boolean } {
    const p = this.mapper(clientX, clientY);
    const inside = p.inside ?? true;
    return {
      x: p.x,
      y: p.y,
      inside,
      inArea: this.area === 'stage' ? this.overTarget(clientX, clientY) : inside,
    };
  }

  private overTarget(clientX: number, clientY: number): boolean {
    const t = this.target;
    if (!t) return false;
    const r = t.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  private adopt(e: PointerEvent, x: number, y: number, inside: boolean): void {
    const p = this.pointer;
    this.primaryId = e.pointerId;
    p.x = x;
    p.y = y;
    p.inside = inside;
    p.down = true;
    p.pressed = true;
    p.touch = e.pointerType !== 'mouse';
    p.active = true;
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button !== 0) {
      this.syncRightButton(e);
      return;
    }
    // Swipes are gestures, not positional presses: track them anywhere on the stage.
    const now = performance.now();
    const s = this.swipeStart;
    if (!s || s.fired || now - s.t > SWIPE_MAX_MS) {
      this.swipeStart = { x: e.clientX, y: e.clientY, t: now, id: e.pointerId, fired: false };
    }
    const at = this.locate(e.clientX, e.clientY);
    let tracked = false;
    if (at.inArea) {
      if (this.primaryId === null || mouse) {
        this.adopt(e, at.x, at.y, at.inside);
      } else if (e.pointerId !== this.primaryId) {
        this.others.set(e.pointerId, { x: at.x, y: at.y, inside: at.inside, touch: !mouse });
      }
      tracked = true;
    }
    if (tracked || this.swipeStart?.id === e.pointerId) {
      try {
        this.target?.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.target) return;
    if (e.pointerType === 'mouse') this.syncRightButton(e);
    const s = this.swipeStart;
    if (s && !s.fired && s.id === e.pointerId) {
      const dir = this.detectSwipe(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t);
      if (dir) {
        s.fired = true;
        if (this.enabled) this.swipes.push(dir);
      }
    }
    const p = this.pointer;
    if (e.pointerId === this.primaryId) {
      // An owned (pressed) pointer keeps steering even when it slides off the area.
      const at = this.locate(e.clientX, e.clientY);
      p.x = at.x;
      p.y = at.y;
      p.inside = at.inside;
      return;
    }
    const other = this.others.get(e.pointerId);
    if (other) {
      const at = this.locate(e.clientX, e.clientY);
      other.x = at.x;
      other.y = at.y;
      other.inside = at.inside;
      return;
    }
    // A hovering mouse steers only while it is over the game area.
    if (e.pointerType !== 'mouse' || this.primaryId !== null || !this.enabled) return;
    const at = this.locate(e.clientX, e.clientY);
    if (at.inArea) {
      p.x = at.x;
      p.y = at.y;
      p.inside = at.inside;
      p.touch = false;
      p.active = true;
    } else if (!p.touch) {
      p.inside = false;
      p.active = false;
    }
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    this.lift(e, false);
  };

  /** A cancelled touch carries no real end point (Chrome reports 0,0), so it never judges a swipe. */
  private readonly onPointerCancel = (e: PointerEvent): void => {
    this.lift(e, true);
  };

  /** Releases a pointer's hold. A cancelled pointer releases too, but judges no swipe and starts no press. */
  private lift(e: PointerEvent, cancelled: boolean): void {
    if (!this.target) return;
    if (e.pointerType === 'mouse') this.syncRightButton(e);
    const s = this.swipeStart;
    if (s && s.id === e.pointerId) {
      if (!s.fired && !cancelled) {
        const dir = this.detectSwipe(e.clientX - s.x, e.clientY - s.y, performance.now() - s.t);
        if (dir && this.enabled) this.swipes.push(dir);
      }
      this.swipeStart = null;
    }
    if (this.others.delete(e.pointerId)) return;
    if (e.pointerId !== this.primaryId) return;
    const p = this.pointer;
    this.primaryId = null;
    p.down = false;
    p.released = true;
    // Hand the pointer to a finger that is still on the game area, without a new press.
    const next = this.others.entries().next();
    if (!next.done) {
      const [id, o] = next.value;
      this.others.delete(id);
      this.primaryId = id;
      p.x = o.x;
      p.y = o.y;
      p.inside = o.inside;
      p.touch = o.touch;
      p.down = true;
    }
  }

  /** The stage suppresses the context menu, so the right mouse button is free for 'secondary'. */
  private syncRightButton(e: PointerEvent): void {
    const held = (e.buttons & 2) !== 0;
    const holding = this.holders.get('secondary')?.has('mouse2') ?? false;
    if (held && !holding && this.enabled && this.locate(e.clientX, e.clientY).inArea) {
      this.press('secondary', 'mouse2');
    } else if (!held && holding) {
      this.release('secondary', 'mouse2');
    }
  }

  private detectSwipe(dx: number, dy: number, ms: number): SwipeDir | null {
    if (ms > SWIPE_MAX_MS) return null;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < SWIPE_MIN_PX) return null;
    if (ax > ay) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }
}

function readPads(): (Gamepad | null)[] | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  try {
    return Array.from(navigator.getGamepads());
  } catch {
    return null;
  }
}

function padMenuMask(pads: (Gamepad | null)[]): number {
  let mask = 0;
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    const ay = pad.axes[1] ?? 0;
    if (b(9)) mask |= MENU_START;
    if (b(0)) mask |= MENU_CONFIRM;
    if (b(1)) mask |= MENU_BACK;
    if (b(13) || b(15) || ay > STICK_DEADZONE_Y) mask |= MENU_NEXT;
    if (b(12) || b(14) || ay < -STICK_DEADZONE_Y) mask |= MENU_PREV;
  }
  return mask;
}
