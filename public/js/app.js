import * as firebase from './firebase.js';
import * as localLedger from './local-ledger.js';
import { manilaDateKey } from './domain.js';
import { renderDashboard, renderReports, resetOverview } from './overview.js';
import { renderOperations, resetOperations } from './operations.js';
import { renderBalances, renderSettings, resetManagement } from './management.js';
import { bindForm, brand, empty, escapeHtml, icon, toast } from './ui.js';

const navigation = [
  ['dashboard', 'Dashboard', 'layout-dashboard'], ['new-transaction', 'New Transaction', 'arrow-left-right'],
  ['history', 'Transaction History', 'history'], ['reports', 'Profit Reports', 'chart-no-axes-column-increasing'],
  ['balances', 'Cash & Wallet Balances', 'wallet'], ['customers', 'Customers', 'users'],
  ['settings', 'Settings', 'settings'],
];
const authRoutes = ['login', 'register', 'forgot-password'];
const routes = new Map(navigation.map(item => [item[0], item[1]]));
const app = document.querySelector('#app');
const mobileLayout = window.matchMedia('(max-width: 900px)');
const local = location.protocol === 'file:' && document.documentElement.dataset.mode === 'local';
const backend = local ? localLedger : firebase;
let account = local ? localLedger.LOCAL_ACCOUNT : undefined;
let offlineOpened = false;
let ledger;
let ledgerError;
let unsubscribe;
let authReady = local;
let authError;
let currentRoute;
let navigationOpen = false;
let currentDay = manilaDateKey();
let theme = 'light';
try { theme = localStorage.getItem('gcash-ledger-theme') === 'dark' ? 'dark' : 'light'; } catch { /* storage is optional */ }
document.documentElement.dataset.theme = theme;

const loading = label => `<div class="app-loading"><span class="spinner" aria-hidden="true"></span> ${label}</div>`;
const themeButton = () => `<button class="icon-btn theme-button" type="button" data-theme-toggle aria-label="Switch to ${theme === 'dark' ? 'light' : 'dark'} mode" title="Switch theme">${icon(theme === 'dark' ? 'sun' : 'moon', 20)}</button>`;

function toggleTheme() {
  theme = theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('gcash-ledger-theme', theme); } catch { /* storage is optional */ }
  for (const button of app.querySelectorAll('[data-theme-toggle]')) {
    button.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon', 20);
    button.setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  }
}

function navigate(route) {
  if (location.hash === `#${route}`) return;
  location.hash = route;
}

function friendlyError(error) {
  const messages = {
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/user-not-found': 'The email or password is incorrect.',
    'auth/email-already-in-use': 'An account already uses this email address.',
    'auth/weak-password': 'Choose a stronger password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'Unable to reach Firebase. Check your connection and try again.',
    'auth/operation-not-allowed': 'Enable Email/Password sign-in in Firebase Authentication.',
    'auth/unauthorized-domain': 'Add this site’s hostname to Firebase Authentication → Settings → Authorized domains, then try again.',
    'auth/invalid-api-key': 'The Firebase web API key is invalid. Check the web app configuration and API key restrictions.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'The Firebase web API key is invalid or restricted. Check the web app configuration and API key restrictions.',
    'permission-denied': 'Firestore denied access. Check that the supplied security rules are deployed to this project.',
    unavailable: 'Unable to reach Firestore. Check your connection and try again.',
  };
  return messages[error?.code] ?? (error?.message || 'Something went wrong. Try again.');
}

function authField(name, label, type, attributes = '') {
  return `<label class="field">${label}<input name="${name}" type="${type}" ${attributes} required></label>`;
}

function renderAuth(route) {
  const mode = {
    login: ['Welcome back', 'Sign in to your GCash Ledger workspace.', 'Sign in'],
    register: ['Create your account', 'Set up a private workspace for your transactions.', 'Create account'],
    'forgot-password': ['Reset your password', 'Enter the email address associated with your account.', 'Send reset link'],
  }[route];
  const name = route === 'register' ? authField('name', 'Full name', 'text', 'autocomplete="name" maxlength="80" placeholder="Your name"') : '';
  const password = route === 'forgot-password' ? '' : authField('password', 'Password', 'password', route === 'register' ? 'minlength="6" autocomplete="new-password" placeholder="At least 6 characters"' : 'autocomplete="current-password" placeholder="Your password"');
  const alternative = route === 'login' ? 'New to GCash Ledger? <a href="#register">Create an account</a>' : '<a href="#login">Back to sign in</a>';
  app.innerHTML = `<div class="auth-shell"><aside class="auth-aside"><div>${brand()}<div class="auth-aside-copy"><div class="hero-icon">${icon('wallet', 26)}</div><h2>Your cash and wallet, in one ledger.</h2><p>Record transactions, track balances, and see what you earned from service charges.</p></div></div><span class="auth-footer">${icon('shield-check', 17)} Private account workspace</span></aside>
    <main id="main-content" tabindex="-1" class="auth-main"><div class="auth-top">${brand()}${themeButton()}</div><div class="auth-card"><h1>${mode[0]}</h1><p>${mode[1]}</p>
    ${!firebase.isConfigured ? `<div class="notice" role="status">${icon('info', 18)}<span>Connect this site to Firebase to enable accounts. Add the web app configuration in <code>public/js/firebase-config.js</code>, then publish the site again.</span></div>` : ''}
    ${firebase.isEmulator ? `<div class="notice">${icon('info', 18)}<span>Local Firebase emulator</span></div>` : ''}
    <form id="auth-form">${name}${authField('email', 'Email address', 'email', 'autocomplete="email" placeholder="you@example.com" maxlength="254"')}${password}
    ${route === 'login' ? '<a class="forgot-link" href="#forgot-password">Forgot password?</a>' : ''}
    <p class="form-message" id="auth-error" role="status" hidden></p><button class="btn btn-primary" type="submit" ${firebase.isConfigured ? '' : 'disabled'}>${mode[2]} ${icon('arrow-right', 18)}</button></form><p class="auth-alternative">${alternative}</p></div></main></div>`;
  bindForm(app.querySelector('#auth-form'), async data => {
    const email = data.get('email');
    const message = document.querySelector('#auth-error');
    message.hidden = true;
    if (route === 'forgot-password') {
      try { await firebase.resetPassword(email); } catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      message.className = 'form-message positive';
      message.textContent = 'If an account uses this email, you’ll receive a password reset link.';
      message.hidden = false;
      return;
    }
    if (route === 'register') {
      const registered = await firebase.register(data.get('name'), email, data.get('password'));
      if (account?.uid === registered.uid) {
        account = registered;
        refreshAccount();
      }
    } else {
      await firebase.signIn(email, data.get('password'));
    }
  }, error => {
    const message = document.querySelector('#auth-error');
    if (!message) return toast(friendlyError(error), 'error');
    message.className = 'form-message negative';
    message.textContent = friendlyError(error);
    message.hidden = false;
  });
}

function renderOfflineWelcome() {
  app.innerHTML = `<main id="main-content" tabindex="-1" class="auth-failure"><section class="panel offline-welcome">${brand()}<h1>Offline workspace</h1><p>Records in this workspace are saved in this browser. Open the hosted site to sign in and use your account across devices.</p><button class="btn btn-primary" type="button" id="open-offline-ledger">Open offline ledger ${icon('arrow-right', 18)}</button></section></main>`;
  app.querySelector('#open-offline-ledger').addEventListener('click', () => {
    offlineOpened = true;
    subscribe();
    render(true);
  });
}

function initials(name) {
  return (name ?? '').trim().split(/\s+/).slice(0, 2).map(word => word.charAt(0).toUpperCase()).join('') || 'GL';
}

function refreshAccount() {
  const name = account?.displayName || account?.email || 'GCash Ledger';
  const avatar = app.querySelector('.avatar');
  if (avatar) {
    avatar.textContent = initials(name);
    avatar.setAttribute('title', name);
  }
}

function topDate() {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date());
}

function renderShell(route) {
  const navLink = ([key, label, symbol]) => `<a href="#${key}" class="nav-link" ${key === route ? 'aria-current="page"' : ''}>${icon(symbol, 19)}<span>${escapeHtml(label)}</span></a>`;
  app.innerHTML = `<div class="layout"><aside class="sidebar" id="workspace-navigation"><div class="sidebar-brand">${brand()}<button type="button" class="icon-btn close-nav" data-menu aria-label="Close navigation">${icon('x', 21)}</button></div>
    <nav aria-label="Workspace"><span class="nav-label">Workspace</span>${navigation.slice(0, 6).map(navLink).join('')}</nav>
    <div class="sidebar-bottom"><nav aria-label="${local ? 'Settings' : 'Account'}">${navLink(navigation[6])}${local ? '' : `<button type="button" class="nav-link" data-logout>${icon('log-out', 19)}<span>Logout</span></button>`}</nav><div class="sidebar-note"><span>${icon('shield-check', 17)}</span><span><strong>Manual ledger</strong><small>Cash and wallet tracking</small></span></div></div>
    </aside><button class="mobile-shade" type="button" aria-label="Close navigation" data-menu hidden></button>
    <div class="workspace"><header class="topbar"><div class="topbar-context"><button class="icon-btn mobile-menu" type="button" data-menu aria-expanded="false" aria-controls="workspace-navigation" aria-label="Open navigation">${icon('menu', 22)}</button><span class="topbar-current">${escapeHtml(routes.get(route))}</span></div><div class="topbar-actions">${local || firebase.isEmulator ? `<span class="environment-tag">${local ? 'Local storage' : 'Local emulator'}</span>` : ''}<span class="topbar-date">${icon('calendar-days', 17)} <span>${escapeHtml(topDate())}</span></span>${themeButton()}<a class="avatar" href="#settings" aria-label="${local ? 'Workspace settings' : 'Account settings'}"></a></div></header>
    <main id="main-content" class="page" tabindex="-1"></main></div></div>`;
  refreshAccount();
  setMenu(false);
}

function setMenu(open, manageFocus = false) {
  navigationOpen = open;
  app.querySelector('.layout')?.classList.toggle('menu-open', open);
  const shade = app.querySelector('.mobile-shade');
  if (shade) shade.hidden = !open;
  const workspace = app.querySelector('.workspace');
  if (workspace) workspace.inert = open;
  app.querySelector('.mobile-menu')?.setAttribute('aria-expanded', String(open));
  if (manageFocus) app.querySelector(open ? '.close-nav' : '.mobile-menu')?.focus();
}

function subscribe() {
  unsubscribe?.();
  const uid = account.uid;
  ledger = undefined;
  ledgerError = undefined;
  unsubscribe = backend.subscribeLedger(uid, value => {
    if (account?.uid !== uid) return;
    if (local) {
      account = { ...localLedger.LOCAL_ACCOUNT, displayName: value.displayName };
      refreshAccount();
    }
    ledger = value;
    ledgerError = undefined;
    renderContent();
  }, error => {
    if (account?.uid !== uid) return;
    ledgerError = friendlyError(error);
    renderContent();
  });
}

function confirmLocalReset() {
  if (!local || document.querySelector('#local-reset-dialog')) return;
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.id = 'local-reset-dialog';
  dialog.className = 'operation-dialog';
  dialog.setAttribute('aria-labelledby', 'local-reset-title');
  dialog.innerHTML = `<div class="dialog-content"><div class="dialog-heading"><div><h2 id="local-reset-title">Clear local ledger data?</h2><p>This permanently clears transactions, balance history, opening balances, and ledger preferences from this browser.</p></div></div><form class="dialog-body"><p class="form-message negative" role="alert" hidden></p><div class="dialog-actions"><button class="btn btn-secondary" type="button" id="cancel-local-reset" autofocus>Cancel</button><button class="btn btn-danger" type="submit" id="confirm-local-reset">Clear local data</button></div></form></div>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const button = form.querySelector('[type="submit"]');
  const cancel = dialog.querySelector('#cancel-local-reset');
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (button.disabled) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener?.isConnected) opener.focus();
    else app.querySelector('#clear-local-data, #main-content')?.focus();
  });
  bindForm(form, async () => {
    cancel.disabled = true;
    try { await localLedger.resetLedger(account.uid); } finally { cancel.disabled = false; }
    resetOperations();
    resetManagement();
    resetOverview();
    renderContent();
    dialog.close();
    toast('Local ledger cleared.');
  }, error => {
    const message = form.querySelector('.form-message');
    message.textContent = friendlyError(error);
    message.hidden = false;
  });
  dialog.showModal();
}

function renderContent() {
  const main = app.querySelector('.page');
  if (!main) return;
  if (ledgerError) {
    main.innerHTML = `<section class="panel ledger-error">${empty('Unable to load your ledger', escapeHtml(ledgerError), 'circle-alert')}<button class="btn btn-secondary" id="retry-ledger" type="button">Try again</button>${local ? ' <button class="btn btn-danger" id="clear-local-data" type="button">Clear local data</button>' : ''}</section>`;
    main.querySelector('#retry-ledger').addEventListener('click', () => { subscribe(); renderContent(); });
    main.querySelector('#clear-local-data')?.addEventListener('click', confirmLocalReset);
    return;
  }
  if (!ledger) {
    main.innerHTML = loading('Loading your ledger…');
    return;
  }
  const uid = account?.uid;
  const write = action => async (...args) => {
    try { return await action(uid, ...args); } catch (error) { throw new Error(friendlyError(error), { cause: error }); }
  };
  const ctx = {
    main, uid, local, account, ...ledger, navigate, toast, icon, escapeHtml,
    recordTransaction: write(backend.recordTransaction), correctTransaction: write(backend.correctTransaction), voidTransaction: write(backend.voidTransaction),
    addAdjustment: write(backend.addAdjustment), setOpeningBalances: write(backend.setOpeningBalances), saveSettings: write(backend.saveSettings),
    updateAccount: async name => {
      const updated = await backend.updateAccount(name);
      if (account?.uid === updated.uid) {
        account = updated;
        refreshAccount();
      }
    },
    resetPassword: () => firebase.resetPassword(account.email), confirmLocalReset, friendlyError,
    rerender: renderContent,
  };
  switch (currentRoute) {
    case 'dashboard': renderDashboard(ctx); break;
    case 'reports': renderReports(ctx); break;
    case 'balances': renderBalances(ctx); break;
    case 'settings': renderSettings(ctx); break;
    default: renderOperations(currentRoute, ctx);
  }
}

function render(focus = false) {
  if (!authReady) return;
  if (local && !offlineOpened) {
    document.title = 'Offline workspace · GCash Ledger';
    renderOfflineWelcome();
    return;
  }
  if (authError) {
    app.innerHTML = `<main id="main-content" class="auth-failure"><section class="panel">${empty('Unable to start Firebase', escapeHtml(authError), 'circle-alert')}<button class="btn btn-primary" type="button" id="reload-app">Try again</button></section></main>`;
    app.querySelector('#reload-app').addEventListener('click', () => location.reload());
    return;
  }
  const requested = location.hash.slice(1);
  const route = !account ? (authRoutes.includes(requested) ? requested : 'login') : routes.has(requested) ? requested : 'dashboard';
  currentRoute = route;
  document.title = `${routes.get(route) ?? { login: 'Sign in', register: 'Create account', 'forgot-password': 'Reset password' }[route]} · GCash Ledger`;
  if (authRoutes.includes(route)) renderAuth(route);
  else {
    renderShell(route);
    renderContent();
  }
  if (focus) {
    window.scrollTo(0, 0);
    app.querySelector('#main-content')?.focus({ preventScroll: true });
  }
}

document.querySelector('.skip-link').addEventListener('click', event => {
  event.preventDefault();
  app.querySelector('#main-content')?.focus();
});
app.addEventListener('click', async event => {
  if (event.target.closest('[data-theme-toggle]')) toggleTheme();
  if (event.target.closest('[data-menu]')) setMenu(!navigationOpen, true);
  if (event.target.closest('.sidebar a') && navigationOpen) setMenu(false);
  const logout = event.target.closest('[data-logout]');
  if (logout) {
    logout.disabled = true;
    try { await firebase.logOut(); } catch (error) { toast(friendlyError(error), 'error'); logout.disabled = false; }
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && navigationOpen) setMenu(false, true);
});
mobileLayout.addEventListener('change', () => { if (navigationOpen) setMenu(false); });
window.addEventListener('hashchange', () => render(true));
setInterval(() => {
  const today = manilaDateKey();
  if (today === currentDay) return;
  currentDay = today;
  const dateLabel = app.querySelector('.topbar-date span');
  if (dateLabel) dateLabel.textContent = topDate();
  if (currentRoute === 'dashboard' || currentRoute === 'reports') renderContent();
}, 60_000);

if (local) {
  render();
} else {
  firebase.observeAuth(user => {
    const previous = account?.uid;
    account = user;
    authReady = true;
    authError = undefined;
    if (previous !== user?.uid) {
      resetOperations();
      resetManagement();
      resetOverview();
      if (user) subscribe();
      else {
        unsubscribe?.();
        ledger = undefined;
        ledgerError = undefined;
        history.replaceState(null, '', '#login');
      }
    }
    if (user && authRoutes.includes(location.hash.slice(1))) history.replaceState(null, '', '#dashboard');
    render();
  }, error => {
    authReady = true;
    authError = friendlyError(error);
    render();
  });
}
