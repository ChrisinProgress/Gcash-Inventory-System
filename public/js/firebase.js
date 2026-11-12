import { firebaseConfig } from './firebase-config.js';
import { DEFAULT_SETTINGS, calculateTransaction, isTransactionDate, manilaDateKey, normalizeCustomer, transactionDate, validateFeeTiers } from './domain.js';

const location = globalThis.location;
export const isEmulator = Boolean(location &&
  ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) &&
  new URLSearchParams(location.search).get('emulator') === '1');
export const isConfigured = isEmulator || ['apiKey', 'authDomain', 'projectId', 'appId'].every(key => {
  const value = firebaseConfig[key];
  return typeof value === 'string' && value.trim() && !value.startsWith('YOUR_');
});

const demoConfig = {
  apiKey: 'demo-gcash-ledger-key',
  authDomain: 'demo-gcash-ledger.firebaseapp.com',
  projectId: 'demo-gcash-ledger',
  appId: '1:000000000000:web:demo-gcash-ledger',
};

let firebase;

function connect() {
  if (!isConfigured) {
    return Promise.reject(new Error('Set up Firebase in public/js/firebase-config.js to connect your account.'));
  }
  firebase ??= Promise.all([
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js'),
  ]).then(([appSdk, authSdk, dbSdk]) => {
    const app = appSdk.initializeApp(isEmulator ? demoConfig : firebaseConfig);
    const auth = authSdk.initializeAuth(app, { persistence: authSdk.indexedDBLocalPersistence });
    const db = dbSdk.getFirestore(app);
    if (isEmulator) {
      authSdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      dbSdk.connectFirestoreEmulator(db, '127.0.0.1', 8088);
    }
    return { auth, authSdk, db, dbSdk };
  });
  return firebase;
}

export function observeAuth(onChange, onError = console.error) {
  if (!isConfigured) {
    queueMicrotask(() => onChange(null));
    return () => {};
  }
  let active = true;
  let unsubscribe;
  connect().then(({ auth, authSdk }) => {
    if (active) unsubscribe = authSdk.onAuthStateChanged(auth, onChange, onError);
  }).catch(error => {
    if (active) onError(error);
  });
  return () => {
    active = false;
    unsubscribe?.();
  };
}

function boundedText(value, maximum, label, required = false) {
  const text = String(value ?? '').trim();
  if (required && !text) throw new Error(`Enter ${label}.`);
  if (text.length > maximum) throw new Error(`Keep ${label} to ${maximum} characters or fewer.`);
  return text;
}

export async function signIn(email, password) {
  const { auth, authSdk } = await connect();
  const credentials = await authSdk.signInWithEmailAndPassword(auth, email.trim(), password);
  return credentials.user;
}

export async function register(name, email, password) {
  const displayName = boundedText(name, 80, 'your name', true);
  const { auth, authSdk } = await connect();
  const { user } = await authSdk.createUserWithEmailAndPassword(auth, email.trim(), password);
  await authSdk.updateProfile(user, { displayName });
  return user;
}

export async function resetPassword(email) {
  const { auth, authSdk } = await connect();
  await authSdk.sendPasswordResetEmail(auth, email.trim());
}

export async function logOut() {
  const { auth, authSdk } = await connect();
  await authSdk.signOut(auth);
}

export async function updateAccount(name) {
  const displayName = boundedText(name, 80, 'your name', true);
  const { auth, authSdk } = await connect();
  if (!auth.currentUser) throw new Error('Sign in to update your profile.');
  await authSdk.updateProfile(auth.currentUser, { displayName });
  return auth.currentUser;
}

async function ledgerConnection(uid) {
  const { auth, db, dbSdk } = await connect();
  if (!uid || auth.currentUser?.uid !== uid) throw new Error('Sign in to access your ledger.');
  return { db, dbSdk, root: dbSdk.doc(db, 'users', uid) };
}

async function initializeLedger({ db, dbSdk, root }) {
  try {
    await dbSdk.runTransaction(db, async transaction => {
      if ((await transaction.get(root)).exists()) return;
      transaction.set(root, {
        cash: 0,
        wallet: 0,
        openingCash: 0,
        openingWallet: 0,
        settings: DEFAULT_SETTINGS,
        lastOperation: null,
        updatedAt: dbSdk.serverTimestamp(),
      });
    });
  } catch (error) {
    if (error.code !== 'permission-denied') throw error;
    const latest = await dbSdk.getDocFromServer(root).catch(() => null);
    if (!latest?.exists()) throw error;
  }
}

function timestamp(value) {
  return value?.toMillis() ?? null;
}

function publicRecord(data) {
  const { referenceKey, feeTierIndex, ownerId, ...record } = data;
  return {
    ...record,
    createdAt: timestamp(data.createdAt),
    ...(data.updatedAt ? { updatedAt: timestamp(data.updatedAt) } : {}),
  };
}

export function subscribeLedger(uid, onChange, onError = console.error) {
  let active = true;
  const unsubscribers = [];
  const fail = error => { if (active) onError(error); };
  ledgerConnection(uid).then(async connection => {
    await initializeLedger(connection);
    if (!active) return;
    const { db, dbSdk, root } = connection;
    let state;
    let transactions;
    let adjustments;
    let audits;
    const watchCollection = (name, orderField, receive) => {
      const query = dbSdk.query(dbSdk.collection(root, name), dbSdk.orderBy(orderField, 'desc'));
      unsubscribers.push(dbSdk.onSnapshot(query, snapshot => receive(snapshot.docs.map(doc => doc.data())), fail));
    };
    unsubscribers.push(dbSdk.onSnapshot(root, snapshot => {
      if (!snapshot.exists()) return;
      const { cash, wallet, openingCash, openingWallet, settings } = snapshot.data();
      state = { cash, wallet, openingCash, openingWallet, settings };
    }, fail));
    watchCollection('transactions', 'createdAt', records => { transactions = records; });
    watchCollection('adjustments', 'createdAt', records => { adjustments = records; });
    watchCollection('audit', 'at', records => { audits = records; });
    // Publish after all listeners affected by a commit have received their snapshots.
    unsubscribers.push(dbSdk.onSnapshotsInSync(db, () => {
      if (!active || !state || !transactions || !adjustments || !audits) return;
      const auditByTransaction = new Map();
      for (const entry of audits) {
        const entries = auditByTransaction.get(entry.transactionId) ?? [];
        entries.push({ action: entry.action, at: timestamp(entry.at), reason: entry.reason, before: publicRecord(entry.before) });
        auditByTransaction.set(entry.transactionId, entries);
      }
      onChange({
        state,
        transactions: transactions.map(data => ({ ...publicRecord(data), audit: auditByTransaction.get(data.id) ?? [] })),
        adjustments: adjustments.map(publicRecord),
      });
    }));
  }).catch(fail);
  return () => {
    active = false;
    unsubscribers.forEach(unsubscribe => unsubscribe());
  };
}

async function mutate(uid, callback) {
  const { db, dbSdk, root } = await ledgerConnection(uid);
  for (let retry = 0; ; retry++) {
    let readVersion;
    try {
      return await dbSdk.runTransaction(db, async transaction => {
        const state = (await transaction.get(root)).data();
        if (!state) throw new Error('Wait for the ledger to finish loading.');
        readVersion = state.updatedAt;
        return callback({
          state,
          transaction,
          document: (collection, id) => dbSdk.doc(root, collection, id),
          updateState: (patch, kind, id, requestId) => transaction.update(root, {
            ...patch,
            lastOperation: { kind, id, requestId },
            updatedAt: dbSdk.serverTimestamp(),
          }),
          now: dbSdk.serverTimestamp,
        });
      });
    } catch (error) {
      // Rules can reject a stale balance before Firestore reports a transaction conflict.
      if (error.code !== 'permission-denied' || !readVersion || retry >= 2) throw error;
      const latest = await dbSdk.getDocFromServer(root).catch(() => null);
      const latestVersion = latest?.data()?.updatedAt;
      if (!latestVersion || readVersion.isEqual(latestVersion)) throw error;
    }
  }
}

const idPattern = /^[a-zA-Z0-9_-]{16,80}$/;

function operationId(value) {
  value ??= crypto.randomUUID();
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error('The operation ID is invalid.');
  return value;
}

const balanceLimit = 999_999_999_999;

function validBalance(value) {
  return Number.isSafeInteger(value) && Math.abs(value) <= balanceLimit;
}

function checkBalances(state, cash, wallet) {
  if (!validBalance(cash) || !validBalance(wallet)) throw new Error('The resulting balance is outside the supported range.');
  if (cash < Math.min(state.cash, 0)) throw new Error('Insufficient cash on hand for this operation.');
  if (wallet < Math.min(state.wallet, 0)) throw new Error('Insufficient GCash wallet balance for this operation.');
}

export async function saveSettings(uid, settings) {
  const feeTiers = validateFeeTiers(settings.feeTiers);
  const { cashOutFeeMode } = settings;
  if (!['deduct', 'separate'].includes(cashOutFeeMode)) throw new Error('Choose a valid cash-out fee method.');
  const id = operationId();
  await mutate(uid, ({ updateState }) => {
    updateState({ settings: { feeTiers, cashOutFeeMode } }, 'settings', id, id);
  });
}

function validatedDraft(draft) {
  const { occurredOn } = draft;
  if (occurredOn !== undefined && !isTransactionDate(occurredOn)) throw new Error('Choose a valid transaction date.');
  const customer = normalizeCustomer(draft.customer);
  const reference = boundedText(draft.reference, 64, 'the reference number');
  if (reference && !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(reference)) {
    throw new Error('Use letters, numbers, periods, hyphens or underscores in the reference number.');
  }
  return {
    occurredOn,
    customer,
    reference,
    referenceKey: reference ? `ref-${reference.toLowerCase()}` : '',
    notes: boundedText(draft.notes, 1000, 'the notes'),
  };
}

function priceTransaction(draft, settings) {
  const quote = calculateTransaction(draft, settings);
  if ((draft.expectedFee !== undefined && quote.fee !== draft.expectedFee) ||
      (draft.expectedFeeMode !== undefined && quote.feeMode !== draft.expectedFeeMode)) {
    throw new Error('Service charges changed. Review the updated calculation and confirm again.');
  }
  const feeTierIndex = settings.feeTiers.findIndex(tier => quote.amount <= tier.max);
  return { ...quote, feeTierIndex };
}

async function reserveReference(context, oldKey, newKey, transactionId) {
  if (oldKey === newKey) return;
  const { transaction, document, now } = context;
  if (newKey) {
    const reference = document('references', newKey);
    if ((await transaction.get(reference)).exists()) {
      throw new Error('This reference number already belongs to a completed transaction.');
    }
    transaction.set(reference, { transactionId, createdAt: now() });
  }
  if (oldKey) transaction.delete(document('references', oldKey));
}

export async function recordTransaction(uid, draft) {
  const id = operationId(draft.requestId);
  const details = validatedDraft(draft);
  return mutate(uid, async context => {
    const { state, transaction, document, updateState, now } = context;
    const reference = document('transactions', id);
    if ((await transaction.get(reference)).exists()) return id;
    const quote = priceTransaction(draft, state.settings);
    const cash = state.cash + quote.cashDelta;
    const wallet = state.wallet + quote.walletDelta;
    checkBalances(state, cash, wallet);
    await reserveReference(context, '', details.referenceKey, id);
    transaction.set(reference, {
      ...quote, ...details, occurredOn: details.occurredOn ?? manilaDateKey(), id, ownerId: uid,
      status: 'completed', createdAt: now(), updatedAt: now(),
    });
    updateState({ cash, wallet }, 'record', id, id);
    return id;
  });
}

async function reviseTransaction(uid, id, action, input) {
  operationId(id);
  const { draft, expectedUpdatedAt } = input;
  const reason = boundedText(input.reason, 500, 'the reason');
  const requestId = operationId(draft?.requestId);
  const details = draft ? validatedDraft(draft) : null;
  return mutate(uid, async context => {
    const { state, transaction, document, updateState, now } = context;
    const reference = document('transactions', id);
    const audit = document('audit', requestId);
    const [record, auditRecord] = await Promise.all([transaction.get(reference), transaction.get(audit)]);
    const previous = record.data();
    if (!previous) throw new Error('This transaction was not found.');
    if (auditRecord.exists()) {
      const saved = auditRecord.data();
      if (saved.transactionId === id && saved.action === action) return id;
      throw new Error('The operation ID has already been used.');
    }
    if (previous.status === 'voided' && action === 'voided') return id;
    if (previous.status !== 'completed') throw new Error('A voided transaction cannot be corrected.');
    if (expectedUpdatedAt != null && timestamp(previous.updatedAt) !== expectedUpdatedAt) {
      throw new Error('This transaction changed. Open the updated transaction and try again.');
    }
    const quote = draft ? priceTransaction(draft, state.settings) : null;
    const cash = state.cash - previous.cashDelta + (quote?.cashDelta ?? 0);
    const wallet = state.wallet - previous.walletDelta + (quote?.walletDelta ?? 0);
    if (quote) checkBalances(state, cash, wallet);
    await reserveReference(context, previous.referenceKey, details?.referenceKey ?? '', id);
    transaction.set(audit, { transactionId: id, action, at: now(), reason, before: previous });
    transaction.update(reference, draft
      ? { ...quote, ...details, occurredOn: details.occurredOn ?? transactionDate(publicRecord(previous)), updatedAt: now() }
      : { status: 'voided', updatedAt: now() });
    updateState({ cash, wallet }, action === 'corrected' ? 'correct' : 'void', id, requestId);
    return id;
  });
}

export function correctTransaction(uid, id, draft, reason) {
  return reviseTransaction(uid, id, 'corrected', { draft, reason, expectedUpdatedAt: draft.expectedUpdatedAt });
}

export function voidTransaction(uid, id, reason, expectedUpdatedAt) {
  return reviseTransaction(uid, id, 'voided', { reason, expectedUpdatedAt });
}

async function postAdjustment(uid, requestId, reason, calculate) {
  const id = operationId(requestId);
  const explanation = boundedText(reason, 500, 'the reason');
  return mutate(uid, async ({ state, transaction, document, updateState, now }) => {
    const reference = document('adjustments', id);
    if ((await transaction.get(reference)).exists()) return id;
    const { kind, account, cashDelta, walletDelta, opening } = calculate(state);
    const cash = state.cash + cashDelta;
    const wallet = state.wallet + walletDelta;
    checkBalances(state, cash, wallet);
    transaction.set(reference, {
      id, ownerId: uid, kind, account, cashDelta, walletDelta,
      beforeCash: state.cash, beforeWallet: state.wallet, afterCash: cash, afterWallet: wallet,
      reason: explanation, createdAt: now(),
    });
    updateState({ cash, wallet, ...opening }, kind, id, id);
    return id;
  });
}

export function setOpeningBalances(uid, { cash, wallet, reason, requestId }) {
  return postAdjustment(uid, requestId, reason, state => {
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

export function addAdjustment(uid, { account, delta, reason, requestId }) {
  return postAdjustment(uid, requestId, reason, () => {
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
