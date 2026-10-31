import { ApiError } from '../../meta/cloud/api';
import {
  type AuthMode,
  checkCredentials,
  CLIENT_PASSWORD_MAX,
  CLIENT_PASSWORD_MIN,
  describeCloudError,
} from '../../meta/cloud/credentials';
import type {
  CloudStatus,
  ProgressAnswer,
  ProgressChoice,
  ProgressSummary,
  SyncPhase,
} from '../../meta/cloud/sync';
import type { App } from '../app';
import { fmt, h } from '../dom';
import { Modal } from '../overlay';

type AccountStatus = Extract<CloudStatus, { kind: 'account' }>;

const PHASE_TEXT: Record<SyncPhase, string> = {
  saved: 'All progress is saved to your account.',
  saving: 'Saving…',
  offline: 'Offline. Changes will sync when you reconnect.',
  retry: "Couldn't reach the server. Will retry shortly.",
  error: "Couldn't save your latest changes. They stay on this device.",
};

export function syncPhaseText(phase: SyncPhase): string {
  return PHASE_TEXT[phase];
}

const uid = (): string => Math.random().toString(36).slice(2, 8);

/** The account dialog: a sign-in form when signed out, sync details and sign-out when signed in. */
export function openAccountDialog(app: App): void {
  const modal = new Modal(app.overlayHost, { title: 'Account', className: 'modal--small' });
  let formMode: AuthMode = 'signin';
  let shown: CloudStatus['kind'] | null = null;

  const focusFirstInput = () => modal.body.querySelector<HTMLInputElement>('input')?.focus();

  const showForm = (mode: AuthMode, username = '') => {
    formMode = mode;
    shown = 'guest';
    modal.body.replaceChildren(authForm(app, modal, mode, username, showForm));
    focusFirstInput();
  };

  const show = () => {
    const s = app.cloud.current;
    shown = s.kind;
    if (s.kind === 'account') modal.body.replaceChildren(accountView(app, modal, s));
    else if (s.kind === 'guest') showForm(formMode);
    else modal.body.replaceChildren(notice(app, s.kind));
  };

  show();
  // Modal focuses the primary button on open. Move focus to the first field instead.
  requestAnimationFrame(() => {
    if (modal.isOpen && app.cloud.current.kind === 'guest') focusFirstInput();
  });

  const off = app.cloud.subscribe((s) => {
    if (!modal.isOpen) {
      off();
      return;
    }
    if (s.kind === 'account' || s.kind !== shown) show();
  });
}

function authForm(
  app: App,
  modal: Modal,
  mode: AuthMode,
  username: string,
  switchTo: (mode: AuthMode, username: string) => void,
): HTMLElement {
  const id = uid();
  const register = mode === 'register';

  const userInput = h('input', {
    class: 'input',
    attrs: {
      id: `${id}-user`,
      name: 'username',
      type: 'text',
      autocomplete: 'username',
      autocapitalize: 'none',
      spellcheck: 'false',
      maxlength: 20,
      required: true,
      'aria-describedby': `${id}-user-hint ${id}-user-err`,
    },
  });
  userInput.value = username;

  const passInput = h('input', {
    class: 'input',
    attrs: {
      id: `${id}-pass`,
      name: 'password',
      type: 'password',
      autocomplete: register ? 'new-password' : 'current-password',
      maxlength: CLIENT_PASSWORD_MAX,
      required: true,
      'aria-describedby': register ? `${id}-pass-hint ${id}-pass-err` : `${id}-pass-err`,
    },
  });

  const userHint = h('span', {
    class: 'muted small',
    text: '3–20 letters, numbers or underscores.',
    attrs: { id: `${id}-user-hint` },
  });
  const userErr = h('span', { class: 'form-error', attrs: { id: `${id}-user-err`, hidden: true } });
  const passHint = register
    ? h('span', {
        class: 'muted small',
        text: `At least ${CLIENT_PASSWORD_MIN} characters.`,
        attrs: { id: `${id}-pass-hint` },
      })
    : null;
  const passErr = h('span', { class: 'form-error', attrs: { id: `${id}-pass-err`, hidden: true } });

  const formErr = h('p', { class: 'form-error', attrs: { role: 'alert', hidden: true } });
  const busy = h('p', { class: 'muted small', attrs: { role: 'status', hidden: true } });

  const submit = h('button', {
    class: 'btn btn--primary',
    text: register ? 'Create account' : 'Sign in',
    attrs: { type: 'submit' },
  });
  const switcher = h('button', {
    class: 'btn btn--ghost',
    text: register ? 'Sign in instead' : 'Create an account',
    attrs: { type: 'button' },
    on: { click: () => switchTo(register ? 'signin' : 'register', userInput.value) },
  });

  const setError = (el: HTMLElement, input: HTMLInputElement, message: string | null) => {
    el.textContent = message ?? '';
    el.hidden = message === null;
    if (message === null) input.removeAttribute('aria-invalid');
    else input.setAttribute('aria-invalid', 'true');
  };
  const setFormError = (message: string | null) => {
    formErr.textContent = message ?? '';
    formErr.hidden = message === null;
  };
  const setBusy = (on: boolean, text = '') => {
    submit.disabled = on;
    switcher.disabled = on;
    busy.hidden = !on;
    busy.textContent = text;
  };

  let pending = false;
  const attempt = async () => {
    if (pending) return;
    const name = userInput.value.trim();
    const pass = passInput.value;
    userInput.value = name;
    const issue = checkCredentials(name, pass, mode);
    setError(userErr, userInput, issue?.field === 'username' ? issue.message : null);
    setError(passErr, passInput, issue?.field === 'password' ? issue.message : null);
    setFormError(null);
    if (issue) {
      (issue.field === 'username' ? userInput : passInput).focus();
      return;
    }
    pending = true;
    setBusy(true, register ? 'Creating your account…' : 'Signing in…');
    try {
      const credentials = { username: name, password: pass };
      if (register) await app.cloud.register(credentials);
      else await app.cloud.signIn(credentials);
      app.toaster.show({
        title: register ? 'Account created' : 'Signed in',
        body: `Signed in as ${name}.`,
        icon: 'user',
        tone: 'success',
      });
      modal.close();
    } catch (err) {
      setFormError(describeCloudError(err));
      if (err instanceof ApiError && err.code === 'invalid_credentials') {
        passInput.value = '';
        passInput.focus();
      }
    } finally {
      pending = false;
      setBusy(false);
    }
  };

  const form = h(
    'form',
    { class: 'account-form', attrs: { novalidate: true } },
    h('p', {
      class: 'muted',
      text: register
        ? 'Back up your progress and climb the global boards. This device’s progress moves into the new account.'
        : 'Sign in to sync your progress across devices and climb the global boards.',
    }),
    field('Username', userInput, userHint, userErr),
    field('Password', passInput, passHint, passErr),
    formErr,
    busy,
    h('div', { class: 'modal__actions' }, switcher, submit),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void attempt();
  });
  return form;
}

function field(label: string, input: HTMLInputElement, ...extra: (HTMLElement | null)[]): HTMLElement {
  return h(
    'div',
    { class: 'field' },
    h('label', { class: 'field__label', text: label, attrs: { for: input.id } }),
    input,
    ...extra,
  );
}

function accountView(app: App, modal: Modal, s: AccountStatus): HTMLElement {
  const runs =
    s.pendingRuns > 0 ? ` ${s.pendingRuns} game run${s.pendingRuns === 1 ? '' : 's'} waiting to upload.` : '';
  return h(
    'div',
    { class: 'account-view' },
    h('p', null, 'Signed in as ', h('strong', { text: s.user.username })),
    h('p', { class: 'small', text: syncPhaseText(s.phase) + runs, attrs: { role: 'status' } }),
    h('p', {
      class: 'muted small',
      text: 'Progress and game runs sync to your account. This device keeps its own copy too.',
    }),
    h(
      'div',
      { class: 'modal__actions' },
      h('button', {
        class: 'btn btn--ghost',
        text: 'Sign out',
        attrs: { type: 'button' },
        on: {
          click: () => {
            app.cloud.signOut();
            app.toaster.show({
              title: 'Signed out',
              body: 'Your progress stays on this device.',
              icon: 'user',
            });
            modal.close();
          },
        },
      }),
    ),
  );
}

function notice(app: App, kind: 'checking' | 'unavailable'): HTMLElement {
  if (kind === 'checking') return h('p', { class: 'muted', text: 'Checking your account…' });
  return h(
    'div',
    { class: 'account-view' },
    h('p', {
      text: 'Accounts are unavailable right now. Your progress is saved on this device, so nothing is lost.',
    }),
    h(
      'div',
      { class: 'modal__actions' },
      h('button', {
        class: 'btn btn--primary',
        text: 'Try again',
        attrs: { type: 'button' },
        on: { click: () => app.cloud.retry() },
      }),
    ),
  );
}

/**
 * Shown once when signing in finds different progress on this device and on the account. The dialog
 * cannot be dismissed: the player has to pick one of the two copies.
 */
export function askProgressChoice(host: HTMLElement, choice: ProgressChoice): Promise<ProgressAnswer> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (answer: ProgressAnswer) => {
      if (done) return;
      done = true;
      modal.close();
      resolve(answer);
    };
    const modal = new Modal(host, {
      title: 'Which progress to keep?',
      className: 'modal--small',
      dismissible: false,
    });
    const line = (label: string, s: ProgressSummary) =>
      h('li', null, h('strong', { text: label }), ` ${fmt(s.games)} games · ${fmt(s.coins)} coins`);
    modal.body.append(
      h('p', {
        class: 'muted',
        text: `${choice.username} already has saved progress, and this device has different progress.`,
      }),
      h('ul', { class: 'small' }, line('This device:', choice.device), line('Account:', choice.account)),
      h('p', { class: 'muted small', text: 'Choose the progress to keep. The other copy is replaced.' }),
      h(
        'div',
        { class: 'modal__actions' },
        h('button', {
          class: 'btn btn--ghost',
          text: 'Keep device progress',
          attrs: { type: 'button' },
          on: { click: () => finish('device') },
        }),
        h('button', {
          class: 'btn btn--primary',
          text: 'Use account progress',
          attrs: { type: 'button' },
          on: { click: () => finish('account') },
        }),
      ),
    );
  });
}
