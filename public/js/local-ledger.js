import { DEFAULT_SETTINGS, calculateTransaction, isTransactionDate, manilaDateKey, normalizeCustomer, transactionDate, validateFeeTiers } from './domain.js';

const storageKey = 'gcash-ledger-local-v1';
const balanceLimit = 999_999_999_999;
const idPattern = /^[a-zA-Z0-9_-]{16,80}$/;
const subscribers = new Set();

export const LOCAL_ACCOUNT = Object.freeze({ uid: 'local', displayName: 'Local workspace' });

function blankLedger() {
  return {
    displayName: LOCAL_ACCOUNT.displayName,
    state: { cash: 0, wallet: 0, openingCash: 0, openingWallet: 0, settings: DEFAULT_SETTINGS },
    transactions: [],
    adjustments: [],
  };
}

function validateSettings(settings) {
  const { cashOutFeeMode } = settings;
  if (cashOutFeeMode !== 'deduct' && cashOutFeeMode !== 'separate') throw new Error('Choose a valid cash-out fee method.');
  return { feeTiers: validateFeeTiers(settings.feeTiers), cashOutFeeMode };
}

function validBalance(value) {
  return Number.isSafeInteger(value) && Math.abs(value) <= balanceLimit;
}

function validTransaction(record) {
  return record && typeof record.id === 'string' && typeof record.customer === 'string'
    && (!Object.hasOwn(record, 'occurredOn') || isTransactionDate(record.occurredOn))
    && typeof record.reference === 'string' && Array.isArray(record.audit)
    && record.audit.every(event => event && typeof event.reason === 'string')
    && ['completed', 'voided'].includes(record.status) && ['cash-in', 'cash-out'].includes(record.type)
    && [record.amount, record.fee, record.profit, record.payout, record.payment, record.cashDelta,
      record.walletDelta, record.createdAt, record.updatedAt].every(Number.isSafeInteger);
}

function validAdjustment(record) {
  return record && typeof record.reason === 'string' && ['opening', 'manual'].includes(record.kind)
    && [record.cashDelta, record.walletDelta, record.afterCash, record.afterWallet, record.createdAt].every(Number.isSafeInteger);
}

function readLedger() {
  let saved;
  try {
    saved = globalThis.localStorage.getItem(storageKey);
  } catch (error) {
    throw new Error('Browser storage is unavailable. Allow local storage for this file or open it in another browser.', { cause: error });
  }
  if (saved === null) return blankLedger();
  try {
    const ledger = JSON.parse(saved);
    const { cash, wallet, openingCash, openingWallet, settings } = ledger.state;
    validateSettings(settings);
    if (![cash, wallet, openingCash, openingWallet].every(validBalance) || openingCash < 0 || openingWallet < 0
      || typeof ledger.displayName !== 'string' || !Array.isArray(ledger.transactions)
      || !ledger.transactions.every(validTransaction) || !Array.isArray(ledger.adjustments)
      || !ledger.adjustments.every(validAdjustment)) {
      throw new Error('Invalid local ledger');
    }
    return ledger;
  } catch (error) {
    throw new Error('The saved local ledger could not be read. You can clear it to start with an empty workspace.', { cause: error });
  }
}

function notify() {
  let ledger;
  try {
    ledger = readLedger();
  } catch (error) {
    for (const { onError } of subscribers) onError(error);
    return;
  }
  for (const { onChange, onError } of subscribers) {
    try { onChange(ledger); } catch (error) { onError(error); }
  }
}

function onStorage(event) {
  if (event.key === storageKey || event.key === null) notify();
}

export function subscribeLedger(_uid, onChange, onError = console.error) {
  if (!subscribers.size) globalThis.addEventListener?.('storage', onStorage);
  const subscriber = { onChange, onError };
  subscribers.add(subscriber);
  queueMicrotask(() => {
    if (!subscribers.has(subscriber)) return;
    try { onChange(readLedger()); } catch (error) { onError(error); }
  });
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) globalThis.removeEventListener?.('storage', onStorage);
  };
}

async function withLock(work) {
  const locks = globalThis.navigator?.locks;
  if (!locks) return work();
  let started = false;
  try {
    return await locks.request(storageKey, () => {
      started = true;
      return work();
    });
  } catch (error) {
    if (started || !['SecurityError', 'NotSupportedError'].includes(error.name)) throw error;
    return work();
  }
}

async function mutate(change) {
  const result = await withLock(() => {
    const ledger = readLedger();
    const result = change(ledger);
    try {
      globalThis.localStorage.setItem(storageKey, JSON.stringify(ledger));
    } catch (error) {
      const message = error.name === 'QuotaExceededError'
        ? 'Browser storage is full. The ledger change was not saved.'
        : 'Browser storage is unavailable. The ledger change was not saved.';
      throw new Error(message, { cause: error });
    }
    return result;
  });
  notify();
  return result;
}

export async function resetLedger() {
  await withLock(() => {
    try {
      globalThis.localStorage.removeItem(storageKey);
    } catch (error) {
      throw new Error('Browser storage is unavailable. The local ledger was not cleared.', { cause: error });
    }
  });
  notify();
}

function boundedText(value, maximum, label, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`Enter ${label}.`);
  if (text.length > maximum) throw new Error(`Keep ${label} to ${maximum} characters or fewer.`);
  return text;
}

export function updateAccount(name) {
  const displayName = boundedText(name, 80, 'your name', true);
  return mutate(ledger => {
    ledger.displayName = displayName;
    return { ...LOCAL_ACCOUNT, displayName };
  });
}

export function saveSettings(_uid, settings) {
  const validated = validateSettings(settings);
  return mutate(({ state }) => { state.settings = validated; });
}

function operationId(value) {
  if (value == null) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error('The operation ID is invalid.');
  return value;
}

function checkBalances(state, cash, wallet, voiding = false) {
  if (!validBalance(cash) || !validBalance(wallet)) throw new Error('The resulting balance is outside the supported range.');
  if (voiding) return;
  if (cash < Math.min(state.cash, 0)) throw new Error('Insufficient cash on hand for this operation.');
  if (wallet < Math.min(state.wallet, 0)) throw new Error('Insufficient GCash wallet balance for this operation.');
}

function detailsFor(draft) {
  const { occurredOn } = draft;
  if (occurredOn !== undefined && !isTransactionDate(occurredOn)) throw new Error('Choose a valid transaction date.');
  const customer = normalizeCustomer(draft.customer);
  const reference = boundedText(draft.reference, 64, 'the reference number');
  if (reference && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(reference)) {
    throw new Error('Use letters, numbers, periods, hyphens or underscores in the reference number.');
  }
  return { occurredOn, customer, reference, notes: boundedText(draft.notes, 1000, 'the notes') };
}

function quoteFor(draft, settings) {
  const quote = calculateTransaction(draft, settings);
  if ((draft.expectedFee !== undefined && quote.fee !== draft.expectedFee)
    || (draft.expectedFeeMode !== undefined && quote.feeMode !== draft.expectedFeeMode)) {
    throw new Error('Service charges changed. Review the updated calculation and confirm again.');
  }
  return quote;
}

function checkReference(transactions, reference, id) {
  if (!reference) return;
  const key = reference.toLowerCase();
  if (transactions.some(record => record.id !== id && record.status === 'completed' && record.reference.toLowerCase() === key)) {
    throw new Error('This reference number already belongs to a completed transaction.');
  }
}

export function recordTransaction(_uid, draft) {
  const id = operationId(draft.requestId);
  const details = detailsFor(draft);
  return mutate(({ state, transactions }) => {
    if (transactions.some(record => record.id === id)) return id;
    const quote = quoteFor(draft, state.settings);
    const cash = state.cash + quote.cashDelta;
    const wallet = state.wallet + quote.walletDelta;
    checkBalances(state, cash, wallet);
    checkReference(transactions, details.reference, id);
    const now = Date.now();
    transactions.unshift({
      ...quote, ...details, occurredOn: details.occurredOn ?? manilaDateKey(now), id,
      status: 'completed', createdAt: now, updatedAt: now, audit: [],
    });
    Object.assign(state, { cash, wallet });
    return id;
  });
}

function reviseTransaction(id, action, reason, expectedUpdatedAt, draft) {
  operationId(id);
  const explanation = boundedText(reason, 500, 'the reason');
  const requestId = operationId(draft?.requestId);
  const details = draft ? detailsFor(draft) : null;
  return mutate(({ state, transactions }) => {
    const record = transactions.find(transaction => transaction.id === id);
    if (!record) throw new Error('This transaction was not found.');
    const saved = transactions.find(transaction => transaction.audit.some(event => event.requestId === requestId));
    if (saved) {
      if (saved.id === id && saved.audit.some(event => event.requestId === requestId && event.action === action)) return id;
      throw new Error('The operation ID has already been used.');
    }
    if (record.status === 'voided' && action === 'voided') return id;
    if (record.status !== 'completed') throw new Error('A voided transaction cannot be corrected.');
    if (expectedUpdatedAt != null && record.updatedAt !== expectedUpdatedAt) {
      throw new Error('This transaction changed. Open the updated transaction and try again.');
    }
    const quote = draft ? quoteFor(draft, state.settings) : null;
    const cash = state.cash - record.cashDelta + (quote?.cashDelta ?? 0);
    const wallet = state.wallet - record.walletDelta + (quote?.walletDelta ?? 0);
    checkBalances(state, cash, wallet, !draft);
    if (details) checkReference(transactions, details.reference, id);
    const { audit, ...before } = record;
    const now = Math.max(Date.now(), record.updatedAt + 1);
    audit.unshift({ requestId, action, at: now, reason: explanation, before });
    Object.assign(record, draft
      ? { ...quote, ...details, occurredOn: details.occurredOn ?? transactionDate(record), updatedAt: now }
      : { status: 'voided', updatedAt: now });
    Object.assign(state, { cash, wallet });
    return id;
  });
}

export function correctTransaction(_uid, id, draft, reason) {
  return reviseTransaction(id, 'corrected', reason, draft.expectedUpdatedAt, draft);
}

export function voidTransaction(_uid, id, reason, expectedUpdatedAt) {
  return reviseTransaction(id, 'voided', reason, expectedUpdatedAt);
}

function postAdjustment(requestId, reason, calculate) {
  const id = operationId(requestId);
  const explanation = boundedText(reason, 500, 'the reason');
  return mutate(({ state, adjustments }) => {
    if (adjustments.some(record => record.id === id)) return id;
    const { kind, account, cashDelta, walletDelta, opening } = calculate(state);
    const cash = state.cash + cashDelta;
    const wallet = state.wallet + walletDelta;
    checkBalances(state, cash, wallet);
    adjustments.unshift({
      id, kind, account, cashDelta, walletDelta,
      beforeCash: state.cash, beforeWallet: state.wallet, afterCash: cash, afterWallet: wallet,
      reason: explanation, createdAt: Date.now(),
    });
    Object.assign(state, { cash, wallet, ...opening });
    return id;
  });
}

export function setOpeningBalances(_uid, { cash, wallet, reason, requestId }) {
  return postAdjustment(requestId, reason, state => {
    if (!validBalance(cash) || cash < 0 || !validBalance(wallet) || wallet < 0) {
      throw new Error('Enter valid, non-negative opening balances.');
    }
    return {
      kind: 'opening',
      account: 'both',
      cashDelta: cash - state.openingCash,
      walletDelta: wallet - state.openingWallet,
      opening: { openingCash: cash, openingWallet: wallet },
    };
  });
}

export function addAdjustment(_uid, { account, delta, reason, requestId }) {
  return postAdjustment(requestId, reason, () => {
    if (!['cash', 'wallet'].includes(account) || !validBalance(delta) || delta === 0) {
      throw new Error('Choose an account and enter a non-zero adjustment amount.');
    }
    return {
      kind: 'manual',
      account,
      cashDelta: account === 'cash' ? delta : 0,
      walletDelta: account === 'wallet' ? delta : 0,
    };
  });
}
