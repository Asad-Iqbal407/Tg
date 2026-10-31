import { h } from './dom';
import { icon, type IconName } from './icons';

export interface ToastOptions {
  title: string;
  body?: string;
  icon?: IconName;
  tone?: 'info' | 'success' | 'gold' | 'error';
  ms?: number;
}

/** Pause before a line that does not fit starts to scroll, and the pause it holds at its end (ms). */
const RUN_DELAY_MS = 900;
const RUN_HOLD_MS = 1200;
/** Scroll speed of a line that does not fit (CSS px per second). */
const RUN_SPEED = 55;

export interface TextRun {
  /** How far the text moves left (CSS px, negative). */
  shift: number;
  /** Length of the scroll itself (ms). */
  ms: number;
  /** Shortest time the toast must stay up so the whole line can be read (ms). */
  minShowMs: number;
}

/**
 * How a one-line toast text that is `overflow` CSS px too wide scrolls to show its end: after a short
 * pause it slides left at a steady reading speed, then holds. Null when it fits, or when motion is
 * reduced (the line keeps its ellipsis then).
 */
export function textRun(overflow: number, reducedMotion: boolean): TextRun | null {
  if (!(overflow > 1) || reducedMotion) return null;
  const shift = Math.ceil(overflow) + 4;
  const ms = Math.round((shift / RUN_SPEED) * 1000);
  return { shift: -shift, ms, minShowMs: RUN_DELAY_MS + ms + RUN_HOLD_MS };
}

function motionReduced(): boolean {
  if (document.documentElement.classList.contains('reduced-motion')) return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Non-blocking notifications announced to screen readers via a polite live region. */
export class Toaster {
  private readonly root: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = h('div', { class: 'toasts', attrs: { 'aria-live': 'polite', role: 'status' } });
    parent.appendChild(this.root);
  }

  show(o: ToastOptions): void {
    const el = h(
      'div',
      { class: `toast toast--${o.tone ?? 'info'}` },
      h('span', { class: 'toast__icon' }, icon(o.icon ?? 'sparkle')),
      h(
        'div',
        { class: 'toast__text' },
        h('strong', { text: o.title }),
        o.body ? h('span', { text: o.body }) : null,
      ),
    );
    this.root.appendChild(el);
    while (this.root.children.length > 4) this.root.firstElementChild?.remove();
    let timer = 0;
    const close = () => {
      clearTimeout(timer);
      el.classList.add('toast--out');
      setTimeout(() => el.remove(), 300);
    };
    el.addEventListener('click', close);
    const shown = Date.now();
    const ms = o.ms ?? 3600;
    timer = window.setTimeout(close, ms);
    // A line squeezed to one row (the in-play toast) scrolls to show its end instead of hiding it.
    requestAnimationFrame(() => {
      if (!el.isConnected || el.classList.contains('toast--out')) return;
      let need = 0;
      for (const line of Array.from(el.querySelectorAll<HTMLElement>('.toast__text > *'))) {
        const run = textRun(line.scrollWidth - line.clientWidth, motionReduced());
        if (!run) continue;
        const inner = h('em', { class: 'toast__run', text: line.textContent ?? '' });
        inner.style.setProperty('--run-shift', `${run.shift}px`);
        inner.style.setProperty('--run-ms', `${run.ms}ms`);
        line.replaceChildren(inner);
        line.classList.add('is-running');
        need = Math.max(need, run.minShowMs);
      }
      if (need > ms) {
        clearTimeout(timer);
        timer = window.setTimeout(close, need - (Date.now() - shown));
      }
    });
  }
}

export interface ModalOptions {
  title: string;
  className?: string;
  /** Called when dismissed via Escape, backdrop or close button. Return false to veto. */
  onDismiss?: () => boolean | void;
  dismissible?: boolean;
}

/** Accessible modal dialog with focus trapping and focus restoration. */
export class Modal {
  readonly el: HTMLElement;
  readonly body: HTMLElement;
  private readonly backdrop: HTMLElement;
  private readonly previousFocus: Element | null;
  private closed = false;

  constructor(
    host: HTMLElement,
    private readonly opts: ModalOptions,
  ) {
    this.previousFocus = document.activeElement;
    const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
    this.body = h('div', { class: 'modal__body' });
    const closeBtn =
      opts.dismissible === false
        ? null
        : h(
            'button',
            {
              class: 'icon-btn modal__close',
              attrs: { type: 'button', 'aria-label': 'Close' },
              on: { click: () => this.dismiss() },
            },
            icon('close'),
          );
    this.el = h(
      'div',
      {
        class: `modal ${opts.className ?? ''}`,
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
      },
      h(
        'header',
        { class: 'modal__header' },
        h('h2', { class: 'modal__title', text: opts.title, attrs: { id: titleId } }),
        closeBtn,
      ),
      this.body,
    );
    this.backdrop = h('div', { class: 'modal-backdrop' }, this.el);
    this.backdrop.addEventListener('mousedown', (e) => {
      if (e.target === this.backdrop) this.dismiss();
    });
    this.backdrop.addEventListener('keydown', this.onKey);
    host.appendChild(this.backdrop);
    requestAnimationFrame(() => {
      this.backdrop.classList.add('modal-backdrop--in');
      const preferred = this.body.querySelector<HTMLElement>('.btn--primary:not([disabled])');
      const first = preferred ?? this.focusables()[0];
      (first ?? this.el).focus({ preventScroll: true });
    });
    this.el.tabIndex = -1;
  }

  get isOpen(): boolean {
    return !this.closed;
  }

  private focusables(): HTMLElement[] {
    return Array.from(
      this.el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.closest('[hidden]'));
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      this.dismiss();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = this.focusables();
    if (f.length === 0) return;
    const first = f[0] as HTMLElement;
    const last = f[f.length - 1] as HTMLElement;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  dismiss(): void {
    if (this.opts.dismissible === false) return;
    if (this.opts.onDismiss?.() === false) return;
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.backdrop.classList.remove('modal-backdrop--in');
    setTimeout(() => this.backdrop.remove(), 180);
    if (this.previousFocus instanceof HTMLElement && document.contains(this.previousFocus))
      this.previousFocus.focus();
  }
}

/** Promise-based confirmation dialog. */
export function confirmDialog(
  host: HTMLElement,
  title: string,
  message: string,
  confirmLabel = 'Confirm',
  danger = false,
): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean) => {
      if (done) return;
      done = true;
      modal.close();
      resolve(v);
    };
    const modal = new Modal(host, { title, className: 'modal--small', onDismiss: () => finish(false) });
    modal.body.append(
      h('p', { class: 'muted', text: message }),
      h(
        'div',
        { class: 'modal__actions' },
        h('button', {
          class: 'btn btn--ghost',
          text: 'Cancel',
          attrs: { type: 'button' },
          on: { click: () => finish(false) },
        }),
        h('button', {
          class: `btn ${danger ? 'btn--danger' : 'btn--primary'}`,
          text: confirmLabel,
          attrs: { type: 'button' },
          on: { click: () => finish(true) },
        }),
      ),
    );
  });
}
