export const MIN_TRANSACTION_AMOUNT = 100;
export const MAX_TRANSACTION_AMOUNT = 1_100_000;
export const MIN_TRANSACTION_DATE = '1900-01-01';
export const MAX_TRANSACTION_DATE = '9998-12-31';

export const DEFAULT_FEE_TIERS = Object.freeze([
  [100, 5], [500, 10], [1_000, 20], [1_500, 30], [2_000, 40],
  [2_500, 50], [3_000, 60], [3_500, 70], [4_000, 80], [4_500, 90],
  [5_000, 100], [5_500, 110], [6_000, 120], [6_500, 130], [7_000, 140],
  [7_500, 150], [8_000, 160], [8_500, 170], [9_000, 180], [9_500, 190],
  [10_000, 200], [11_000, 210],
].map(([maximumPesos, feePesos]) => Object.freeze({
  max: maximumPesos * 100,
  fee: feePesos * 100,
})));

export const DEFAULT_SETTINGS = Object.freeze({
  feeTiers: DEFAULT_FEE_TIERS,
  cashOutFeeMode: 'deduct',
});

const pesoFormatter = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const manila = 'Asia/Manila';
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: manila, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: manila, year: 'numeric', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});
const dateFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric',
});
const shortDateFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC', month: 'short', day: 'numeric',
});
const monthFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC', month: 'long', year: 'numeric',
});
const monthShortFormatter = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'UTC', month: 'short',
});

export function parseMoney(input) {
  const value = String(input ?? '').trim();
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.replace(/[-,]/g, '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) return null;
  return value.startsWith('-') && cents ? -cents : cents;
}

export function money(cents) {
  return Number.isSafeInteger(cents) ? pesoFormatter.format(cents / 100) : '—';
}

export function decimal(cents) {
  if (!Number.isSafeInteger(cents)) return '';
  const absolute = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

export function normalizeCustomer(input) {
  const number = String(input ?? '').trim().replace(/[\s()-]/g, '');
  if (/^09\d{9}$/.test(number)) return number;
  if (/^\+?639\d{9}$/.test(number)) return `0${number.slice(-10)}`;
  throw new Error('Enter a Philippine GCash mobile number such as 09171234567.');
}

export function validateFeeTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length !== DEFAULT_FEE_TIERS.length) {
    throw new Error('Keep all 22 service charge tiers.');
  }
  return DEFAULT_FEE_TIERS.map(({ max }, index) => {
    const tier = tiers[index];
    if (tier?.max !== max || !Number.isSafeInteger(tier.fee) || tier.fee < 0 || tier.fee > MAX_TRANSACTION_AMOUNT) {
      throw new Error(`Enter a service charge from ₱0.00 to ₱11,000.00 for the tier ending at ${money(max)}.`);
    }
    return { max, fee: tier.fee };
  });
}

export function serviceCharge(amount, tiers = DEFAULT_FEE_TIERS) {
  if (!Number.isSafeInteger(amount) || amount < MIN_TRANSACTION_AMOUNT || amount > MAX_TRANSACTION_AMOUNT) {
    throw new Error('Enter an amount from ₱1.00 to ₱11,000.00 with up to two decimal places.');
  }
  return validateFeeTiers(tiers).find(({ max }) => amount <= max).fee;
}

export function calculateTransaction(draft, settings = DEFAULT_SETTINGS) {
  const { type, amount } = draft;
  const feeMode = settings.cashOutFeeMode;
  if (type !== 'cash-in' && type !== 'cash-out') throw new Error('Choose Cash In or Cash Out.');
  if (feeMode !== 'deduct' && feeMode !== 'separate') throw new Error('Choose a valid Cash Out fee method.');
  const fee = serviceCharge(amount, settings.feeTiers);
  const isCashIn = type === 'cash-in';
  const takesPayment = isCashIn || feeMode === 'separate';
  const payment = isCashIn ? amount + fee : (takesPayment ? fee : 0);
  const payout = isCashIn ? 0 : amount - (takesPayment ? 0 : fee);
  if (payout < 0) throw new Error('The service charge exceeds the Cash Out amount.');

  const received = takesPayment ? draft.received ?? draft.amountReceived ?? null : null;
  if (received !== null && (!Number.isSafeInteger(received) || received < payment)) {
    throw new Error(`Amount received must be at least ${money(payment)}.`);
  }

  return {
    type,
    amount,
    fee,
    total: isCashIn ? payment : payout,
    payment,
    payout,
    received,
    amountReceived: received,
    change: received === null ? null : received - payment,
    cashDelta: payment - payout,
    walletDelta: isCashIn ? -amount : amount,
    profit: fee,
    feeMode,
  };
}

function asTimestamp(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : NaN;
}

export function manilaDateKey(timestamp = Date.now()) {
  const time = asTimestamp(timestamp);
  if (!Number.isFinite(time) || !Number.isFinite(new Date(time).getTime())) return '';
  const parts = Object.fromEntries(dayFormatter.formatToParts(time).map(({ type, value }) => [type, value]));
  return `${parts.year.padStart(4, '0')}-${parts.month}-${parts.day}`;
}

export function formatDateTime(timestamp) {
  const time = asTimestamp(timestamp);
  return Number.isFinite(new Date(time).getTime()) ? timeFormatter.format(time) : '—';
}

function calendarDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const date = new Date(`${key}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key ? date : null;
}

export function isTransactionDate(value) {
  return Boolean(calendarDate(value) && value >= MIN_TRANSACTION_DATE && value <= MAX_TRANSACTION_DATE);
}

export function formatDate(key) {
  const date = calendarDate(key);
  return date ? dateFormatter.format(date) : '—';
}

function shiftDays(key, days) {
  const date = calendarDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function shiftMonths(key, months) {
  const date = calendarDate(key);
  date.setUTCMonth(date.getUTCMonth() + months, 1);
  return date.toISOString().slice(0, 10);
}

function weekLabel(start, end) {
  const lastDay = shiftDays(end, -1);
  const firstLabel = start.slice(0, 4) === lastDay.slice(0, 4)
    ? shortDateFormatter.format(calendarDate(start))
    : formatDate(start);
  return `${firstLabel} – ${formatDate(lastDay)}`;
}

export function transactionDate(transaction) {
  if (isTransactionDate(transaction.occurredOn)) return transaction.occurredOn;
  return manilaDateKey(transaction.occurredAt ?? transaction.createdAt ?? null);
}

function emptySummary() {
  return { cashInCount: 0, cashOutCount: 0, cashInAmount: 0, cashOutAmount: 0, count: 0, fees: 0, profit: 0 };
}

function isCompleted(transaction) {
  return transaction.status === 'completed' && (transaction.type === 'cash-in' || transaction.type === 'cash-out');
}

function addToSummary(summary, transaction) {
  if (transaction.type === 'cash-in') {
    summary.cashInCount += 1;
    summary.cashInAmount += transaction.amount;
  } else {
    summary.cashOutCount += 1;
    summary.cashOutAmount += transaction.amount;
  }
  summary.count += 1;
  summary.fees += transaction.fee;
  summary.profit += transaction.profit;
  return summary;
}

export function summarize(transactions) {
  return transactions.filter(isCompleted).reduce(addToSummary, emptySummary());
}

export function dateWindow(period, selectedDate = manilaDateKey()) {
  const date = calendarDate(selectedDate);
  if (!date) throw new Error('Choose a valid report date.');
  if (period === 'all') return { start: null, end: null, previousStart: null, label: 'All time', previousLabel: null };
  if (period === 'day') {
    const previousStart = shiftDays(selectedDate, -1);
    return {
      start: selectedDate, end: shiftDays(selectedDate, 1), previousStart,
      label: formatDate(selectedDate), previousLabel: formatDate(previousStart),
    };
  }
  if (period === 'week') {
    const start = shiftDays(selectedDate, -((date.getUTCDay() + 6) % 7));
    const end = shiftDays(start, 7);
    const previousStart = shiftDays(start, -7);
    return {
      start, end, previousStart,
      label: weekLabel(start, end), previousLabel: weekLabel(previousStart, start),
    };
  }
  if (period === 'month') {
    const start = `${selectedDate.slice(0, 7)}-01`;
    const previousStart = shiftMonths(start, -1);
    return {
      start, end: shiftMonths(start, 1), previousStart,
      label: monthFormatter.format(calendarDate(start)),
      previousLabel: monthFormatter.format(calendarDate(previousStart)),
    };
  }
  if (period === 'year') {
    const year = selectedDate.slice(0, 4);
    const start = `${year}-01-01`;
    const previousStart = shiftMonths(start, -12);
    return {
      start, end: shiftMonths(start, 12), previousStart,
      label: year, previousLabel: previousStart.slice(0, 4),
    };
  }
  throw new Error('Choose a valid report period.');
}

function chartBuckets(period, start, end, transactions) {
  const buckets = new Map();
  const add = (key, label, firstDay, endDay) => {
    buckets.set(key, { label, start: firstDay, end: endDay, ...emptySummary() });
  };
  if (period === 'day' || period === 'week' || period === 'month') {
    for (let day = start; day < end; day = shiftDays(day, 1)) {
      add(day, shortDateFormatter.format(calendarDate(day)), day, shiftDays(day, 1));
    }
  } else if (period === 'year') {
    for (let month = start; month < end; month = shiftMonths(month, 1)) {
      add(month.slice(0, 7), monthShortFormatter.format(calendarDate(month)), month, shiftMonths(month, 1));
    }
  } else if (transactions.length) {
    const years = transactions.map(({ date }) => date.slice(0, 4)).sort();
    for (let year = Number(years[0]); year <= Number(years.at(-1)); year += 1) {
      const label = String(year).padStart(4, '0');
      const firstDay = `${label}-01-01`;
      add(label, label, firstDay, shiftMonths(firstDay, 12));
    }
  }
  return buckets;
}

export function report(transactions, { period = 'month', date = manilaDateKey() } = {}) {
  const window = dateWindow(period, date);
  const { start, end, previousStart } = window;
  const current = emptySummary();
  const previous = start ? emptySummary() : null;
  const records = [];

  for (const transaction of transactions) {
    if (!isCompleted(transaction)) continue;
    const date = transactionDate(transaction);
    if (!date) continue;
    if (!start || (date >= start && date < end)) {
      addToSummary(current, transaction);
      records.push({ transaction, date });
    } else if (date >= previousStart && date < start) {
      addToSummary(previous, transaction);
    }
  }

  const buckets = chartBuckets(period, start, end, records);
  for (const { transaction, date } of records) {
    let key = date;
    if (period === 'year') key = date.slice(0, 7);
    if (period === 'all') key = date.slice(0, 4);
    const bucket = buckets.get(key);
    if (bucket) addToSummary(bucket, transaction);
  }

  const profitChange = previous ? current.profit - previous.profit : null;
  let profitChangePercent = null;
  if (previous?.profit) profitChangePercent = (profitChange / previous.profit) * 100;
  if (previous && !previous.profit && !current.profit) profitChangePercent = 0;
  return {
    ...window,
    current,
    previous,
    profitChange,
    profitChangePercent,
    series: [...buckets.values()],
    transactions: records.map(({ transaction }) => transaction),
  };
}

export function analytics(transactions, limit = 5) {
  const amounts = new Map();
  const days = new Map();
  const customers = new Map();

  for (const transaction of transactions) {
    if (!isCompleted(transaction)) continue;
    amounts.set(transaction.amount, (amounts.get(transaction.amount) ?? 0) + 1);
    const date = transactionDate(transaction);
    if (date) days.set(date, (days.get(date) ?? 0) + 1);
    if (!transaction.customer) continue;
    if (!customers.has(transaction.customer)) {
      customers.set(transaction.customer, { customer: transaction.customer, lastAt: null, ...emptySummary() });
    }
    const customer = customers.get(transaction.customer);
    const time = asTimestamp(transaction.occurredAt ?? transaction.createdAt);
    if (Number.isFinite(time) && (customer.lastAt === null || time > customer.lastAt)) customer.lastAt = time;
    addToSummary(customer, transaction);
  }

  return {
    frequentAmounts: [...amounts].map(([amount, count]) => ({ amount, count }))
      .sort((a, b) => b.count - a.count || a.amount - b.amount).slice(0, limit),
    activeDays: [...days].map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date)).slice(0, limit),
    customers: [...customers.values()].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0) || a.customer.localeCompare(b.customer)),
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  const negativeNumber = /^-\d+(?:\.\d+)?$/.test(text);
  if (typeof value === 'string' && !negativeNumber && /^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvText(headers, rows) {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadCsv(filename, headers, rows) {
  const blob = new Blob(['\uFEFF', csvText(headers, rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
