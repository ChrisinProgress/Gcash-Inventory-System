import {
  calculateTransaction, decimal, downloadCsv, formatDate, isTransactionDate, manilaDateKey,
  MAX_TRANSACTION_DATE, MIN_TRANSACTION_DATE, money, normalizeCustomer, parseMoney, transactionDate,
} from './domain.js';
import { heading, newRequestId } from './ui.js';

const transactionTypes = { 'cash-in': 'Cash In', 'cash-out': 'Cash Out' };
const historyPageSize = 25;
const monthName = new Intl.DateTimeFormat('en-PH', { month: 'long', timeZone: 'Asia/Manila' });
const months = Array.from({ length: 12 }, (_, month) => ({
  value: String(month + 1).padStart(2, '0'),
  label: monthName.format(Date.UTC(2000, month, 1)),
}));

function newDraft() {
  return { type: 'cash-in', customer: '', amount: '', amountReceived: '', reference: '', notes: '', occurredOn: null, reason: '', requestId: null };
}

function createView(uid = null) {
  return {
    uid, route: '', context: null, draft: newDraft(), editing: null, editReturn: 'history', modal: null,
    filters: { search: '', type: '', date: '', month: '', year: '', status: '' },
    historyPage: 0, customerSearch: '', activeCustomer: '',
  };
}

let view = createView();

export function resetOperations() {
  const { modal } = view;
  view = createView();
  if (modal?.open) modal.close();
  modal?.remove();
}

export function renderOperations(route, context) {
  const uid = context.uid ?? null;
  if (view.uid !== uid) {
    resetOperations();
    view = createView(uid);
  }
  const active = document.activeElement;
  const focused = view.route === route && context.main.contains(active)
    ? (active.name ? `[name="${CSS.escape(active.name)}"]` : active.hasAttribute('data-customer-search') ? '[data-customer-search]' : '')
    : '';
  const selection = focused && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd]
    : null;
  view.route = route;
  view.context = context;
  if (route === 'new-transaction') renderTransaction(context);
  if (route === 'history') renderHistory(context);
  if (route === 'customers') renderCustomers(context);
  if (focused) {
    const field = context.main.querySelector(focused);
    field?.focus({ preventScroll: true });
    if (selection) field?.setSelectionRange(...selection);
  }
}

function statusPill(status) {
  return status === 'voided'
    ? '<span class="pill pill-voided">Voided</span>'
    : '<span class="pill pill-completed">Completed</span>';
}

function totalLabel(transaction) {
  return transaction.type === 'cash-in' ? 'Total payment' : 'Cash payout';
}

function transactionTotal(transaction) {
  return transaction.type === 'cash-in' ? transaction.payment : transaction.payout;
}

function compareTransactions(left, right) {
  return transactionDate(right).localeCompare(transactionDate(left)) || right.createdAt - left.createdAt;
}

function showMoney(cents) {
  return cents == null ? '—' : money(cents);
}

function definitions(entries, escapeHtml) {
  return '<dl class="calculation-list">' + entries.map(([label, value, className = '']) =>
    `<div class="${className}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
  ).join('') + '</dl>';
}

function transactionAmounts(transaction, escapeHtml) {
  const separateFee = transaction.type === 'cash-out' && transaction.feeMode === 'separate';
  const chargeCollected = transaction.type === 'cash-in' || separateFee;
  return definitions([
    ['Amount', showMoney(transaction.amount)],
    [separateFee ? 'Service charge (paid separately)' : 'Service charge', showMoney(transaction.fee)],
    [totalLabel(transaction), showMoney(transactionTotal(transaction)), 'calculation-total'],
    ...(chargeCollected ? [
      [transaction.type === 'cash-in' ? 'Amount received' : 'Fee received', showMoney(transaction.amountReceived ?? transaction.received)],
      ['Change', showMoney(transaction.change)],
    ] : []),
  ], escapeHtml);
}

function quoteFor(context, draft, withTender) {
  const amount = parseMoney(draft.amount);
  const amountReceived = withTender && draft.amountReceived.trim() ? parseMoney(draft.amountReceived) : null;
  if (withTender && draft.amountReceived.trim() && amountReceived == null) {
    throw new Error('Enter a valid amount received with up to two decimal places.');
  }
  const quote = calculateTransaction({ type: draft.type, amount, received: amountReceived }, context.state.settings);
  if (amountReceived === null && (draft.type === 'cash-in' || quote.feeMode === 'separate')) {
    return { ...quote, received: quote.payment, amountReceived: quote.payment, change: 0 };
  }
  return quote;
}

function balanceWarning(context, quote, previous) {
  const { cash, wallet } = context.state;
  const cashAfter = cash - (previous?.cashDelta ?? 0) + quote.cashDelta;
  const walletAfter = wallet - (previous?.walletDelta ?? 0) + quote.walletDelta;
  const cashShortfall = Math.min(cash, 0) - cashAfter;
  const walletShortfall = Math.min(wallet, 0) - walletAfter;
  const missing = [];
  if (cashShortfall > 0) missing.push(`cash on hand (${money(cashShortfall)} short)`);
  if (walletShortfall > 0) missing.push(`GCash wallet balance (${money(walletShortfall)} short)`);
  return missing.length ? `Insufficient ${missing.join(' and ')}.` : '';
}

function renderTransaction(context) {
  const { main, icon, escapeHtml: e } = context;
  const draft = view.draft;
  const editing = view.editing;
  const selectedType = (type) => draft.type === type ? 'true' : 'false';
  const tenderApplicable = draft.type === 'cash-in' || context.state.settings.cashOutFeeMode === 'separate';
  const selectedDate = draft.occurredOn ?? manilaDateKey();
  main.innerHTML = `
    ${heading('New transaction', 'Record a cash-in or cash-out in your ledger.')}
    <div class="operation-layout">
      <section class="panel">
        <div class="panel-heading"><div>
          <h2>${editing ? 'Correct transaction' : 'Transaction details'}</h2>
          <p>${editing ? `Editing ${e(editing.id)}. The original values are kept in the audit history.` : 'Select a transaction type and enter the customer details.'}</p>
        </div></div>
        <form class="transaction-form" data-transaction-form novalidate>
          <fieldset class="type-fieldset">
            <legend>Transaction type</legend>
            <div class="type-options">
              <button type="button" class="type-option" data-type="cash-in" aria-pressed="${selectedType('cash-in')}">
                <span class="type-icon cash-in">${icon('arrow-down-left', 22)}</span>
                <span><strong>Cash In</strong><small>Send to GCash</small></span>
              </button>
              <button type="button" class="type-option" data-type="cash-out" aria-pressed="${selectedType('cash-out')}">
                <span class="type-icon cash-out">${icon('arrow-up-right', 22)}</span>
                <span><strong>Cash Out</strong><small>Pay out cash</small></span>
              </button>
            </div>
          </fieldset>
          <div class="form-grid">
            <label class="field">Customer GCash number
              <input name="customer" type="tel" inputmode="tel" autocomplete="off" placeholder="09XX XXX XXXX" maxlength="24" value="${e(draft.customer)}" required>
            </label>
            <label class="field">Transaction amount
              <span class="money-input"><span aria-hidden="true">₱</span><input name="amount" inputmode="decimal" placeholder="0.00" maxlength="12" value="${e(draft.amount)}" required></span>
            </label>
            <label class="field" data-tender-field ${tenderApplicable ? '' : 'hidden'}>
              <span data-tender-label>${draft.type === 'cash-in' ? 'Amount received' : 'Cash received for the fee'} <span class="optional">(optional)</span></span>
              <span class="money-input"><span aria-hidden="true">₱</span><input name="amountReceived" inputmode="decimal" placeholder="Exact payment" maxlength="12" value="${e(draft.amountReceived)}"></span>
            </label>
            <label class="field"><span>GCash reference number <span class="optional">(optional)</span></span>
              <input name="reference" autocomplete="off" placeholder="Enter a reference number" maxlength="64" value="${e(draft.reference)}">
            </label>
            <label class="field field-full">Transaction date
              <input id="transaction-date" name="occurredOn" type="date" min="${MIN_TRANSACTION_DATE}" max="${MAX_TRANSACTION_DATE}" value="${e(selectedDate)}" required>
            </label>
            <label class="field field-full"><span>Notes <span class="optional">(optional)</span></span>
              <textarea name="notes" rows="3" maxlength="1000" placeholder="Add any relevant details">${e(draft.notes)}</textarea>
            </label>
            ${editing ? `<label class="field field-full"><span>Reason for correction <span class="optional">(optional)</span></span>
              <textarea name="reason" rows="2" maxlength="500" placeholder="Describe the correction">${e(draft.reason)}</textarea>
            </label>` : ''}
          </div>
          <p class="inline-error negative" data-form-error role="alert" hidden></p>
          <div class="form-actions">
            ${editing ? '<button class="btn btn-secondary" type="button" data-cancel-edit>Cancel correction</button>' : ''}
            <button class="btn btn-primary" type="submit">${icon('circle-check', 17)} ${editing ? 'Review correction' : 'Review transaction'}</button>
          </div>
        </form>
      </section>
      <aside class="panel transaction-summary">
        <div class="panel-heading"><div><h2>Transaction summary</h2><p>Calculated from your service charges.</p></div></div>
        <div data-quote aria-live="polite"></div>
        <p class="inline-error negative" data-balance-warning role="status" hidden></p>
        <div class="transaction-date">${icon('calendar-days', 17)} <div><span>Transaction date</span>
          <strong data-summary-date>${e(formatDate(selectedDate))}</strong></div></div>
      </aside>
    </div>`;

  const form = main.querySelector('[data-transaction-form]');
  const dateInput = form.elements.occurredOn;
  const summaryDate = main.querySelector('[data-summary-date]');
  const summary = main.querySelector('[data-quote]');
  const warning = main.querySelector('[data-balance-warning]');
  const error = form.querySelector('[data-form-error]');
  const showError = (message) => {
    error.textContent = message;
    error.hidden = !message;
  };
  const updateSummary = () => {
    let quote = null;
    let tenderWarning = '';
    try {
      quote = quoteFor(context, draft, false);
    } catch (quoteError) {
      if (draft.amount.trim()) tenderWarning = quoteError.message;
    }
    if (quote && tenderApplicable && draft.amountReceived.trim()) {
      try {
        quote = quoteFor(context, draft, true);
      } catch (quoteError) {
        quote = { ...quote, received: null, amountReceived: null, change: null };
        tenderWarning = quoteError.message;
      }
    }
    summary.innerHTML = transactionAmounts(quote ?? { type: draft.type, feeMode: context.state.settings.cashOutFeeMode }, e);
    warning.textContent = [tenderWarning, quote && balanceWarning(context, quote, editing)].filter(Boolean).join(' ');
    warning.hidden = !warning.textContent;
  };

  updateSummary();
  form.addEventListener('input', ({ target }) => {
    if (!Object.hasOwn(draft, target.name)) return;
    draft[target.name] = target.value;
    draft.requestId = null;
    showError('');
    if (target === dateInput) summaryDate.textContent = formatDate(dateInput.value);
    if (target.name === 'amount' || target.name === 'amountReceived') updateSummary();
  });
  form.querySelectorAll('[data-type]').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.type === draft.type) return;
    draft.type = button.dataset.type;
    draft.amountReceived = '';
    draft.requestId = null;
    renderTransaction(context);
    formFocus(main, `[data-type="${draft.type}"]`);
  }));
  form.querySelector('[data-cancel-edit]')?.addEventListener('click', () => {
    view.editing = null;
    view.draft = newDraft();
    context.navigate(view.editReturn);
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const occurredOn = dateInput.value;
      if (!isTransactionDate(occurredOn)) throw new Error('Choose a valid transaction date.');
      const customer = normalizeCustomer(draft.customer);
      const quote = quoteFor(context, draft, tenderApplicable);
      const unavailable = balanceWarning(context, quote, editing);
      if (unavailable) throw new Error(unavailable);
      const reference = draft.reference.trim();
      if (reference && !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(reference)) {
        throw new Error('Use letters, numbers, periods, hyphens or underscores in the reference number. Start with a letter or number.');
      }
      draft.requestId ??= newRequestId();
      const submission = {
        type: draft.type, customer, amount: quote.amount, occurredOn,
        amountReceived: quote.amountReceived,
        reference, notes: draft.notes.trim(), requestId: draft.requestId,
        expectedFee: quote.fee, expectedFeeMode: quote.feeMode, expectedUpdatedAt: editing?.updatedAt,
      };
      reviewTransaction(context, submission, quote, editing, draft.reason.trim());
    } catch (formError) {
      showError(formError.message);
    }
  });
}

function formFocus(main, selector) {
  main.querySelector(selector)?.focus();
}

function openDialog(context, title, body) {
  if (view.modal?.open) view.modal.close();
  const dialog = document.createElement('dialog');
  dialog.className = 'operation-dialog';
  dialog.setAttribute('aria-labelledby', 'operation-dialog-title');
  dialog.innerHTML = `<section class="dialog-content">
    <header class="dialog-heading">
      <h2 id="operation-dialog-title">${context.escapeHtml(title)}</h2>
      <button type="button" class="btn btn-secondary icon-btn" data-close aria-label="Close dialog">${context.icon('x', 18)}</button>
    </header>
    ${body}
  </section>`;
  view.modal = dialog;
  document.body.append(dialog);
  dialog.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => {
    if (!dialog.hasAttribute('aria-busy')) dialog.close();
  }));
  dialog.addEventListener('cancel', (event) => {
    if (dialog.hasAttribute('aria-busy')) event.preventDefault();
  });
  dialog.addEventListener('close', () => {
    if (view.modal === dialog) view.modal = null;
    dialog.remove();
  }, { once: true });
  dialog.showModal();
  return dialog;
}

function bindDialogAction(dialog, form, action) {
  const submit = form.querySelector('[type="submit"]');
  const previous = submit.innerHTML;
  const error = form.querySelector('[data-dialog-error]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (dialog.hasAttribute('aria-busy')) return;
    dialog.setAttribute('aria-busy', 'true');
    const buttons = dialog.querySelectorAll('button');
    buttons.forEach((button) => { button.disabled = true; });
    submit.textContent = 'Saving…';
    error.hidden = true;
    try {
      await action(new FormData(form));
      if (dialog.open) dialog.close();
    } catch (actionError) {
      error.textContent = actionError.message || 'The operation could not be saved. Try again.';
      error.hidden = false;
    } finally {
      dialog.removeAttribute('aria-busy');
      buttons.forEach((button) => { button.disabled = false; });
      submit.innerHTML = previous;
    }
  });
}

function reviewTransaction(context, submission, quote, editing, reason) {
  const { escapeHtml: e, icon } = context;
  const dialog = openDialog(context, editing ? 'Confirm correction' : 'Confirm transaction', `
    <div class="dialog-body">
      ${definitions([
        ['Transaction type', transactionTypes[submission.type]],
        ['Transaction date', formatDate(submission.occurredOn)],
        ['Customer GCash number', submission.customer],
        ...(submission.reference ? [['Reference number', submission.reference]] : []),
        ...(submission.notes ? [['Notes', submission.notes]] : []),
      ], e)}
      ${transactionAmounts(quote, e)}
      ${editing && reason ? `<p><strong>Reason</strong> ${e(reason)}</p>` : ''}
    </div>
    <form class="dialog-action-form">
      <p class="inline-error negative" data-dialog-error role="alert" hidden></p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" data-close autofocus>Go back</button>
        <button type="submit" class="btn btn-primary">${icon('check', 17)} ${editing ? 'Save correction' : 'Confirm transaction'}</button>
      </div>
    </form>`);
  bindDialogAction(dialog, dialog.querySelector('form'), async () => {
    const id = editing
      ? await context.correctTransaction(editing.id, submission, reason)
      : await context.recordTransaction(submission);
    if ((context.uid ?? null) !== view.uid) return;
    view.draft = newDraft();
    view.editing = null;
    context.toast(editing ? 'Transaction corrected.' : `Transaction ${id} saved.`);
    if (editing) context.navigate(view.editReturn);
    else if (view.route === 'new-transaction') renderTransaction(view.context);
  });
}

function searchMatches(transaction, search) {
  const text = search.trim().toLowerCase();
  if (!text) return true;
  const digits = text.replace(/\D/g, '');
  const phone = /^\+?[\d\s().-]+$/.test(text)
    ? (digits.startsWith('639') ? `0${digits.slice(2)}` : digits)
    : '';
  return (phone && transaction.customer.includes(phone))
    || (transaction.reference ?? '').toLowerCase().includes(text);
}

function filterTransactions(transactions, filters) {
  const filterDate = filters.date || filters.month || filters.year;
  return transactions.filter((transaction) => {
    if ((filters.type && transaction.type !== filters.type) ||
        (filters.status && transaction.status !== filters.status) ||
        !searchMatches(transaction, filters.search)) return false;
    if (!filterDate) return true;
    const date = transactionDate(transaction);
    return (!filters.date || date === filters.date)
      && (!filters.month || date.slice(5, 7) === filters.month)
      && (!filters.year || date.slice(0, 4) === filters.year);
  });
}

function selectOptions(options, selected, escapeHtml) {
  return options.map(({ value, label }) => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function renderHistory(context) {
  const { main, transactions, escapeHtml: e, icon } = context;
  const { filters } = view;
  const ordered = [...transactions].sort(compareTransactions);
  const years = [...new Set([filters.year, ...ordered.map((entry) => transactionDate(entry).slice(0, 4))])]
    .filter(Boolean).sort().reverse().map((year) => ({ value: year, label: year }));
  main.innerHTML = `
    ${heading('Transaction history', 'Review cash-in and cash-out activity and download your records.')}
    <section class="panel">
      <div class="panel-heading">
        <div><h2>All transactions</h2><p>Find payments, payouts, and their audit history.</p></div>
        <button type="button" class="btn btn-secondary" data-export>${icon('download', 17)} Export CSV</button>
      </div>
      <div class="history-filters">
        <label class="field history-search">Search
          <span class="search-input">${icon('search', 17)} <input name="search" type="search" placeholder="Customer number or reference" value="${e(filters.search)}"></span>
        </label>
        <label class="field">Type
          <select name="type">${selectOptions([
            { value: '', label: 'All types' }, ...Object.entries(transactionTypes).map(([value, label]) => ({ value, label })),
          ], filters.type, e)}</select>
        </label>
        <label class="field">Date<input name="date" type="date" value="${e(filters.date)}"></label>
        <label class="field">Month<select name="month">${selectOptions([{ value: '', label: 'All months' }, ...months], filters.month, e)}</select></label>
        <label class="field">Year<select name="year">${selectOptions([{ value: '', label: 'All years' }, ...years], filters.year, e)}</select></label>
        <label class="field">Status<select name="status">${selectOptions([
          { value: '', label: 'All statuses' }, { value: 'completed', label: 'Completed' }, { value: 'voided', label: 'Voided' },
        ], filters.status, e)}</select></label>
      </div>
      <div class="history-results">
        <div class="results-meta"><span data-result-count aria-live="polite"></span><button class="btn btn-secondary" type="button" data-clear>Clear filters</button></div>
        <div data-history-results></div>
        <div class="history-pagination" data-pagination hidden>
          <button class="btn btn-secondary" type="button" data-prev-page>Previous</button>
          <span data-page-range aria-live="polite"></span>
          <button class="btn btn-secondary" type="button" data-next-page>Next</button>
        </div>
      </div>
    </section>`;
  const results = main.querySelector('[data-history-results]');
  const count = main.querySelector('[data-result-count]');
  const exportButton = main.querySelector('[data-export]');
  const clearButton = main.querySelector('[data-clear]');
  const pagination = main.querySelector('[data-pagination]');
  const previous = pagination.querySelector('[data-prev-page]');
  const next = pagination.querySelector('[data-next-page]');
  const range = pagination.querySelector('[data-page-range]');
  let matches = [];
  function updateResults() {
    matches = filterTransactions(ordered, filters);
    count.textContent = `${matches.length} ${matches.length === 1 ? 'transaction' : 'transactions'}`;
    exportButton.disabled = matches.length === 0;
    clearButton.hidden = !Object.values(filters).some(Boolean);
    view.historyPage = Math.min(view.historyPage, Math.max(0, Math.ceil(matches.length / historyPageSize) - 1));
    const start = view.historyPage * historyPageSize;
    const end = Math.min(start + historyPageSize, matches.length);
    results.innerHTML = tableFor(matches.slice(start, end), context);
    pagination.hidden = matches.length <= historyPageSize;
    previous.disabled = start === 0;
    next.disabled = end >= matches.length;
    range.textContent = `${start + 1}–${end} of ${matches.length}`;
  }
  previous.addEventListener('click', () => { view.historyPage -= 1; updateResults(); });
  next.addEventListener('click', () => { view.historyPage += 1; updateResults(); });
  main.querySelector('.history-filters').addEventListener('input', ({ target }) => {
    if (!Object.hasOwn(filters, target.name)) return;
    filters[target.name] = target.value;
    view.historyPage = 0;
    updateResults();
  });
  clearButton.addEventListener('click', () => {
    view.historyPage = 0;
    main.querySelectorAll('.history-filters input, .history-filters select').forEach((field) => {
      field.value = '';
      filters[field.name] = '';
    });
    updateResults();
    main.querySelector('[name="search"]').focus();
  });
  exportButton.addEventListener('click', () => exportTransactions(matches, `gcash-transactions-${manilaDateKey(Date.now())}.csv`));
  bindTable(results, context);
  updateResults();
}

function tableFor(transactions, context, customerView = false) {
  const { escapeHtml: e, icon } = context;
  if (!transactions.length) return `<div class="empty operations-empty">
    ${icon('receipt', 30)}
    <strong>No transactions found</strong><p>${customerView ? 'There are no transactions for this customer.' : 'New transactions appear here. If you applied filters, try clearing them.'}</p>
  </div>`;
  return `<div class="table-wrap"><table class="data-table">
    <thead><tr><th scope="col">Transaction ID</th><th scope="col">Date</th>
      ${customerView ? '' : '<th scope="col">Customer</th>'}
      <th scope="col">Type</th><th scope="col">Amount</th><th scope="col">Service charge</th>
      <th scope="col">Payment / payout</th><th scope="col">Profit</th><th scope="col">Status</th><th scope="col">Actions</th>
    </tr></thead>
    <tbody>${transactions.map((entry) => `<tr>
      <td><button class="table-link" type="button" data-transaction-action="detail" data-id="${e(entry.id)}">${e(entry.id)}</button></td>
      <td class="nowrap">${e(formatDate(transactionDate(entry)))}</td>
      ${customerView ? '' : `<td class="nowrap">${e(entry.customer)}</td>`}
      <td class="nowrap"><span class="transaction-type ${entry.type === 'cash-in' ? 'cash-in' : 'cash-out'}">${icon(entry.type === 'cash-in' ? 'arrow-down-left' : 'arrow-up-right', 13)} ${transactionTypes[entry.type]}</span></td>
      <td class="nowrap">${showMoney(entry.amount)}</td><td class="nowrap">${showMoney(entry.fee)}</td>
      <td class="nowrap">${showMoney(transactionTotal(entry))}</td>
      <td class="nowrap ${entry.status === 'completed' ? 'positive' : ''}">${showMoney(entry.status === 'voided' ? 0 : entry.profit)}</td>
      <td>${statusPill(entry.status)}</td>
      <td><div class="table-actions">
        <button type="button" class="btn btn-secondary icon-btn" data-transaction-action="detail" data-id="${e(entry.id)}" title="View details" aria-label="View transaction ${e(entry.id)}">${icon('eye', 16)}</button>
        <button type="button" class="btn btn-secondary icon-btn" data-transaction-action="print" data-id="${e(entry.id)}" title="Print receipt" aria-label="Print receipt for ${e(entry.id)}">${icon('printer', 16)}</button>
      </div></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function bindTable(container, context) {
  container.addEventListener('click', (event) => {
    const button = event.target.closest('[data-transaction-action]');
    if (!button) return;
    const entry = context.transactions.find((transaction) => transaction.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.transactionAction === 'detail') showDetails(context, entry);
    if (button.dataset.transactionAction === 'print') printReceipt(context, entry);
  });
}

function exportTransactions(transactions, filename) {
  const headers = ['Transaction ID', 'Transaction date', 'Customer GCash number', 'Transaction type', 'Amount',
    'Service charge', 'Payment or payout', 'Amount received', 'Change', 'Gross profit', 'Status', 'Reference number', 'Notes'];
  downloadCsv(filename, headers, transactions.map((entry) => [
    entry.id, transactionDate(entry), entry.customer, transactionTypes[entry.type],
    money(entry.amount), money(entry.fee), money(transactionTotal(entry)),
    entry.amountReceived == null ? '' : money(entry.amountReceived),
    entry.change == null ? '' : money(entry.change),
    money(entry.status === 'voided' ? 0 : entry.profit),
    entry.status, entry.reference, entry.notes,
  ]));
}

function auditLog(entry, escapeHtml) {
  const e = escapeHtml;
  const audit = entry.audit ?? [];
  if (!audit.length) return '<p class="muted">No corrections or voids recorded.</p>';
  return `<ol class="audit-log">${audit.map((event) => `
    <li>
      <div><strong>${event.action === 'voided' ? 'Voided' : 'Corrected'}</strong> <span class="muted">${e(formatDate(manilaDateKey(event.at ?? null)))}</span></div>
      ${event.reason ? `<p>${e(event.reason)}</p>` : ''}
      ${event.before ? `<details>
        <summary>Previous values</summary>
        ${definitions([
          ['Transaction type', transactionTypes[event.before.type]],
          ['Transaction date', formatDate(transactionDate(event.before))],
          ['Customer GCash number', event.before.customer],
          ['Amount', showMoney(event.before.amount)],
          ['Service charge', showMoney(event.before.fee)],
          [totalLabel(event.before), showMoney(transactionTotal(event.before))],
          ['Amount received', showMoney(event.before.amountReceived ?? event.before.received)],
          ['Change', showMoney(event.before.change)],
          ['Reference number', event.before.reference || '—'],
          ['Notes', event.before.notes || '—'],
        ], e)}
      </details>` : ''}
    </li>`).join('')}</ol>`;
}

function showDetails(context, entry) {
  const { escapeHtml: e, icon } = context;
  const dialog = openDialog(context, 'Transaction details', `
    <div class="dialog-body">
      <div class="receipt-id"><strong>${e(entry.id)}</strong>${statusPill(entry.status)}</div>
      ${definitions([
        ['Transaction date', formatDate(transactionDate(entry))],
        ['Customer GCash number', entry.customer],
        ['Transaction type', transactionTypes[entry.type]],
        ['Reference number', entry.reference || '—'],
      ], e)}
      ${transactionAmounts(entry, e)}
      ${definitions([
        ['Gross profit', showMoney(entry.status === 'voided' ? 0 : entry.profit)],
        ['Cash movement', showMoney(entry.status === 'voided' ? 0 : entry.cashDelta)],
        ['GCash wallet movement', showMoney(entry.status === 'voided' ? 0 : entry.walletDelta)],
        ['Notes', entry.notes || '—'],
      ], e)}
      <section class="audit-section"><h3>Audit history</h3>${auditLog(entry, e)}</section>
    </div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" type="button" data-print>${icon('printer', 16)} Print receipt</button>
      ${entry.status === 'completed' ? `
        <button class="btn btn-secondary" type="button" data-correct>${icon('pencil', 16)} Correct</button>
        <button class="btn btn-danger" type="button" data-void>${icon('ban', 16)} Void</button>` : ''}
    </div>`);
  dialog.querySelector('[data-print]').addEventListener('click', () => printReceipt(context, entry));
  dialog.querySelector('[data-correct]')?.addEventListener('click', () => {
    dialog.close();
    view.editing = entry;
    view.editReturn = view.route;
    view.draft = {
      ...newDraft(), type: entry.type, customer: entry.customer, amount: decimal(entry.amount),
      amountReceived: entry.amountReceived == null ? '' : decimal(entry.amountReceived),
      reference: entry.reference ?? '', notes: entry.notes ?? '', occurredOn: transactionDate(entry),
    };
    context.navigate('new-transaction');
  });
  dialog.querySelector('[data-void]')?.addEventListener('click', () => showVoid(context, entry));
}

function showVoid(context, entry) {
  const { escapeHtml: e, icon } = context;
  const cashAfter = context.state.cash - entry.cashDelta;
  const walletAfter = context.state.wallet - entry.walletDelta;
  const negativeBalances = [
    ...(cashAfter < 0 ? [`cash on hand at ${money(cashAfter)}`] : []),
    ...(walletAfter < 0 ? [`GCash wallet at ${money(walletAfter)}`] : []),
  ];
  const dialog = openDialog(context, 'Void transaction', `
    <form class="dialog-action-form">
      <div class="dialog-body">
        <p>Void <strong>${e(entry.id)}</strong> to reverse its balance movements and remove its profit from reports. The record stays in your history.</p>
        ${negativeBalances.length ? `<p class="inline-error negative">This void will leave ${e(negativeBalances.join(' and '))}.</p>` : ''}
        <label class="field"><span>Reason for voiding <span class="optional">(optional)</span></span>
          <textarea name="reason" rows="3" maxlength="500" placeholder="Describe why this transaction is being voided"></textarea>
        </label>
        <p class="inline-error negative" data-dialog-error role="alert" hidden></p>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-secondary" data-close autofocus>Cancel</button>
        <button type="submit" class="btn btn-danger">${icon('ban', 16)} Void transaction</button>
      </div>
    </form>`);
  bindDialogAction(dialog, dialog.querySelector('form'), async (data) => {
    const reason = String(data.get('reason') ?? '').trim();
    await context.voidTransaction(entry.id, reason, entry.updatedAt);
    if ((context.uid ?? null) === view.uid) context.toast('Transaction voided.');
  });
}

function printReceipt(context, entry) {
  const e = context.escapeHtml;
  const embeddedFonts = document.querySelector('#poppins-fonts');
  const fontMarkup = embeddedFonts ? `<style>${embeddedFonts.textContent}</style>` : `<link rel="stylesheet" href="${e(new URL('./fonts/poppins.css', document.baseURI).href)}">`;
  const preview = window.open('', '_blank');
  if (!preview) {
    context.toast('Allow pop-ups for this site to print the receipt.', 'error');
    return;
  }
  preview.opener = null;
  preview.document.write(`<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>GCash transaction receipt</title>
    ${fontMarkup}
    <style>
      body{font:15px Poppins,sans-serif;color:#182230;max-width:420px;margin:2rem auto;padding:1rem}
      h1{margin-bottom:.5rem}p{white-space:pre-wrap;overflow-wrap:anywhere}
      dl{border-top:1px solid #cdd5df;margin:1rem 0;padding-top:.5rem}
      dl div{display:flex;align-items:baseline;justify-content:space-between;gap:1rem;padding:.32rem 0}
      dd{margin:0;text-align:right;font-weight:600;overflow-wrap:anywhere}
      .calculation-total{border-top:1px solid #cdd5df;margin-top:.35rem;padding-top:.65rem}
      .pill{border:1px solid #9aa5b1;padding:.15rem .5rem;border-radius:.25rem}
      @media print{body{margin:0 auto;padding:0}}
    </style></head><body>
    <h1>GCash transaction receipt</h1>
    ${statusPill(entry.status)}
    ${definitions([
      ['Transaction ID', entry.id],
      ['Transaction date', formatDate(transactionDate(entry))],
      ['Customer GCash number', entry.customer],
      ['Transaction type', transactionTypes[entry.type]],
      ...(entry.reference ? [['Reference number', entry.reference]] : []),
    ], e)}
    ${transactionAmounts(entry, e)}
    ${entry.notes ? `<p>${e(entry.notes)}</p>` : ''}
    </body></html>`);
  preview.document.close();
  const print = async () => {
    if (preview.closed) return;
    await preview.document.fonts.ready;
    if (preview.closed) return;
    preview.focus();
    preview.print();
  };
  if (preview.document.readyState === 'complete') void print();
  else preview.addEventListener('load', print, { once: true });
}

function customerGroups(transactions) {
  const groups = new Map();
  for (const entry of transactions) {
    if (!groups.has(entry.customer)) {
      groups.set(entry.customer, { number: entry.customer, entries: [], completed: 0, cashIn: 0, cashOut: 0, profit: 0 });
    }
    const customer = groups.get(entry.customer);
    customer.entries.push(entry);
    if (entry.status !== 'completed') continue;
    customer.completed += 1;
    if (entry.type === 'cash-in') customer.cashIn += entry.amount;
    else customer.cashOut += entry.amount;
    customer.profit += entry.profit;
  }
  const customers = [...groups.values()];
  for (const customer of customers) customer.entries.sort(compareTransactions);
  return customers.sort((left, right) => compareTransactions(left.entries[0], right.entries[0]));
}

function renderCustomers(context) {
  const { main, transactions, escapeHtml: e, icon } = context;
  const customers = customerGroups(transactions);
  main.innerHTML = `
    ${heading('Customers', 'Look up a GCash number and review its transaction history.')}
    <div class="customers-layout">
      <section class="panel customer-directory">
        <div class="panel-heading"><div><h2>Customer directory</h2><p>${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}</p></div></div>
        <label class="field">Search customer numbers
          <span class="search-input">${icon('search', 17)} <input type="search" data-customer-search placeholder="GCash number" value="${e(view.customerSearch)}"></span>
        </label>
        <div class="customer-list" data-customer-list></div>
      </section>
      <section class="panel customer-history" data-customer-detail></section>
    </div>`;
  const list = main.querySelector('[data-customer-list]');
  const detail = main.querySelector('[data-customer-detail]');
  function updateCustomers() {
    const matches = customers.filter(({ number }) => searchMatches({ customer: number }, view.customerSearch));
    const selected = matches.find(({ number }) => number === view.activeCustomer) ?? matches[0];
    view.activeCustomer = selected?.number ?? '';
    list.innerHTML = matches.map((customer) => `
      <button class="customer-item" type="button" data-customer="${e(customer.number)}" aria-pressed="${customer === selected}">
        <span class="customer-avatar">${icon('user', 19)}</span>
        <span><strong>${e(customer.number)}</strong><small>${customer.entries.length} ${customer.entries.length === 1 ? 'transaction' : 'transactions'}</small></span>
        ${icon('chevron-right', 17)}
      </button>`).join('') || '<div class="empty">No matching customers.</div>';
    if (!selected) {
      detail.innerHTML = `<div class="empty operations-empty">${icon('users', 32)}
        <strong>${customers.length ? 'No customers match your search' : 'No customer activity yet'}</strong>
        <p>${customers.length ? 'Try another GCash number.' : 'Customer histories appear after you record a transaction.'}</p>
      </div>`;
      return;
    }
    detail.innerHTML = `<div class="panel-heading">
      <div><h2>${e(selected.number)}</h2><p>Last activity ${e(formatDate(transactionDate(selected.entries[0])))}</p></div>
      <button class="btn btn-secondary" type="button" data-export-customer>${icon('download', 17)} Export CSV</button>
    </div>
    ${definitions([
      ['Completed transactions', String(selected.completed)],
      ['Cash In amount', money(selected.cashIn)],
      ['Cash Out amount', money(selected.cashOut)],
      ['Gross profit', money(selected.profit)],
    ], e)}
    <div data-customer-results>${tableFor(selected.entries, context, true)}</div>`;
    detail.querySelector('[data-export-customer]').addEventListener('click', () => exportTransactions(selected.entries, `gcash-customer-${selected.number}.csv`));
    bindTable(detail.querySelector('[data-customer-results]'), context);
  }
  main.querySelector('[data-customer-search]').addEventListener('input', ({ target }) => {
    view.customerSearch = target.value;
    updateCustomers();
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-customer]');
    if (!button) return;
    view.activeCustomer = button.dataset.customer;
    updateCustomers();
    list.querySelector('[aria-pressed="true"]')?.focus();
  });
  updateCustomers();
}
