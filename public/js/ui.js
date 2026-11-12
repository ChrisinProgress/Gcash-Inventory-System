const paths = {
  'layout-dashboard': '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  'arrow-left-right': '<path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4m4 4H4"/>',
  'arrow-down-left': '<path d="M17 7 7 17M17 17H7V7"/>',
  'arrow-up-right': '<path d="M7 17 17 7M7 7h10v10"/>',
  'arrow-right': '<path d="M5 12h14m-7-7 7 7-7 7"/>',
  'arrow-left': '<path d="m12 19-7-7 7-7m-7 7h14"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7m-7-7v14"/>',
  'arrow-down': '<path d="M12 5v14m-7-7 7 7 7-7"/>',
  'list': '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  'history': '<path d="M3 12a9 9 0 1 1 2.7 6.4M3 12V6m0 6h6m3-4v4l3 2"/>',
  'chart-no-axes-column-increasing': '<path d="M12 20V10m6 10V4M6 20v-4"/>',
  'chart-column': '<path d="M3 3v18h18M8 16v-3m5 3V8m5 8v-5"/>',
  'chart-line': '<path d="M3 3v18h18m-15-6 4-4 4 4 6-7"/>',
  'wallet': '<path d="M20 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6m19 6h-5a2 2 0 0 0 0 4h5m-5-2h.01"/>',
  'banknote': '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/><circle cx="9" cy="7" r="4"/>',
  'user': '<circle cx="12" cy="8" r="4"/><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>',
  'settings': '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 0 2.4.2l.1-.1v-2.4l-.1-.1a1.7 1.7 0 0 0-2.4-.2l-.1.1a1.7 1.7 0 0 1-.4-1 1.7 1.7 0 0 1 .4-1l.1-.1a1.7 1.7 0 0 0-.2-2.4l-.1-.1h-2.4l-.1.1a1.7 1.7 0 0 0-.2 2.4l.1.1" opacity="0"/><path d="M12 2h1.5l.6 2.3 1.8.8 2-.9 2 2-.9 2 .8 1.8 2.2.6v2.8l-2.2.6-.8 1.8.9 2-2 2-2-.9-1.8.8-.6 2.3h-3l-.6-2.3-1.8-.8-2 .9-2-2 .9-2-.8-1.8-2.2-.6v-2.8l2.2-.6.8-1.8-.9-2 2-2 2 .9 1.8-.8.6-2.3Z"/>',
  'log-out': '<path d="M10 17l5-5-5-5m5 5H3m9-8h6a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-6"/>',
  'calendar-days': '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 15h.01m4 0h.01m4 0h.01M8 18h.01m4 0h.01"/>',
  'plus': '<path d="M12 5v14M5 12h14"/>',
  'minus': '<path d="M5 12h14"/>',
  'sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  'moon': '<path d="M20.9 13.4A9 9 0 0 1 10.6 3.1 9 9 0 1 0 20.9 13.4Z"/>',
  'menu': '<path d="M4 6h16M4 12h16M4 18h16"/>',
  'x': '<path d="m18 6-12 12M6 6l12 12"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'trending-up': '<path d="m3 17 6-6 4 4 7-7m-5 0h5v5"/>',
  'receipt': '<path d="M4 3l2 1.5L8 3l2 1.5L12 3l2 1.5L16 3l2 1.5L20 3v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L8 21l-2-1.5L4 21Zm4 6h8m-8 4h8"/>',
  'check': '<path d="m5 12 4 4L19 6"/>',
  'circle-check': '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>',
  'circle-alert': '<circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 4h.01"/>',
  'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  'shield-check': '<path d="M12 22s7-3.5 7-10V5l-7-3-7 3v7c0 6.5 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>',
  'download': '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  'printer': '<path d="M6 8V3h12v5M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8" rx="1"/><path d="M6 11h.01"/>',
  'search': '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
  'eye': '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="2.5"/>',
  'pencil': '<path d="m15 6 3 3M4 20l4-.8L20 7l-3-3L5 16l-1 4Z"/>',
  'ban': '<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>',
  'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  'smartphone': '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M12 18h.01"/>',
  'lock': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4m-4 4v2"/>',
  'mail': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  'triangle-alert': '<path d="M10.3 4.7a2 2 0 0 1 3.4 0L22 19H2ZM12 9v4m0 3h.01"/>',
  'ellipsis': '<path d="M5 12h.01m7 0h.01m7 0h.01"/>',
  'filter': '<path d="M4 6h16m-13 6h10m-7 6h4"/>',
  'file-text': '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6M8 13h8m-8 4h8"/>',
};

export function icon(name, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] ?? paths.info}</svg>`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function newRequestId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function brand() {
  return `<a href="#dashboard" class="brand" aria-label="GCash Ledger home"><span class="brand-icon">${icon('wallet', 23)}</span><span><strong>GCash Ledger</strong><small>Business workspace</small></span></a>`;
}

export function heading(title, description = '', actions = '') {
  return `<div class="page-heading"><div><h1>${title}</h1>${description ? `<p>${description}</p>` : ''}</div>${actions ? `<div class="page-actions">${actions}</div>` : ''}</div>`;
}

export function empty(title, description, symbol = 'receipt') {
  return `<div class="empty"><span class="empty-icon">${icon(symbol, 23)}</span><strong>${title}</strong><p>${description}</p></div>`;
}

export function toast(message, type = 'success') {
  const item = document.createElement('div');
  item.className = `toast ${type === 'error' ? 'toast-error' : ''}`;
  item.innerHTML = `${icon(type === 'error' ? 'circle-alert' : 'circle-check')}<span>${escapeHtml(message)}</span><button type="button" aria-label="Dismiss message">${icon('x', 17)}</button>`;
  item.querySelector('button').addEventListener('click', () => item.remove());
  document.querySelector('#toasts').append(item);
  setTimeout(() => item.remove(), type === 'error' ? 8000 : 4600);
}

export function bindForm(form, submit, onError = error => toast(error.message, 'error')) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    if (button.disabled) return;
    const previous = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Saving…';
    try {
      await submit(new FormData(form));
    } catch (error) {
      onError(error);
    } finally {
      button.disabled = false;
      button.innerHTML = previous;
    }
  });
}
