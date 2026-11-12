import { decimal, DEFAULT_FEE_TIERS, formatDateTime, money, parseMoney, validateFeeTiers } from './domain.js';
import { bindForm, empty, escapeHtml, heading, icon, newRequestId } from './ui.js';

let balanceDialog;
let feeDraft;
let nameDraft;

export function resetManagement() {
  balanceDialog?.close();
  feeDraft = undefined;
  nameDraft = undefined;
}

function moneyInput(name, label, amount) {
  return `<label class="field">${label}<span class="input-prefix"><span aria-hidden="true">₱</span><input name="${name}" type="text" inputmode="decimal" placeholder="0.00" value="${escapeHtml(amount)}" maxlength="16" required></span></label>`;
}

function balanceForm(ctx, mode) {
  if (balanceDialog?.open) return;
  const opening = mode === 'opening';
  const opener = document.activeElement;
  const requestId = newRequestId();
  const dialog = document.createElement('dialog');
  dialog.className = 'operation-dialog';
  dialog.setAttribute('aria-labelledby', 'balance-dialog-title');
  const fields = opening ? `<div class="form-grid">${moneyInput('cash', 'Opening cash', decimal(ctx.state.openingCash))}${moneyInput('wallet', 'Opening GCash', decimal(ctx.state.openingWallet))}</div>` : `<div class="form-grid"><label class="field">Account<select name="account"><option value="cash">Cash on hand</option><option value="wallet">GCash wallet</option></select></label><label class="field">Adjustment type<select name="direction"><option value="add">Addition / top-up</option><option value="withdraw">Withdrawal</option></select></label></div>${moneyInput('amount', 'Adjustment amount', '')}`;
  dialog.innerHTML = `<div class="dialog-content"><div class="dialog-heading"><div><h2 id="balance-dialog-title">${opening ? 'Set opening balances' : 'Adjust balance'}</h2><p>${opening ? 'Changes apply the difference to your current balances.' : 'Record a cash movement or wallet top-up.'}</p></div><button class="icon-btn" type="button" data-close aria-label="Close">${icon('x', 20)}</button></div><form class="dialog-body"><div class="management-form">${fields}<label class="field"><span>Reason <span class="optional">(optional)</span></span><textarea name="reason" maxlength="500" rows="3" placeholder="Why are you making this change?"></textarea></label><p class="form-message negative" role="alert" hidden></p></div><div class="dialog-actions"><button class="btn btn-secondary" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">${opening ? 'Save opening balances' : 'Save adjustment'}</button></div></form></div>`;
  document.body.append(dialog);
  balanceDialog = dialog;
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (balanceDialog === dialog) balanceDialog = undefined;
    if (opener?.isConnected) opener.focus();
    else document.querySelector(`[data-balance-form="${mode}"]`)?.focus();
  });
  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => dialog.close());
  const message = dialog.querySelector('.form-message');
  bindForm(dialog.querySelector('form'), async data => {
    message.hidden = true;
    const reason = data.get('reason').trim();
    if (opening) {
      const cash = parseMoney(data.get('cash'));
      const wallet = parseMoney(data.get('wallet'));
      if (cash === null || wallet === null) throw new Error('Enter valid opening balances with up to two decimal places.');
      if (cash === ctx.state.openingCash && wallet === ctx.state.openingWallet) throw new Error('Enter an opening balance that differs from the current opening balance.');
      await ctx.setOpeningBalances({ cash, wallet, reason, requestId });
    } else {
      const amount = parseMoney(data.get('amount'));
      if (amount === null || amount <= 0) throw new Error('Enter a positive amount with up to two decimal places.');
      const delta = data.get('direction') === 'withdraw' ? -amount : amount;
      await ctx.addAdjustment({ account: data.get('account'), delta, reason, requestId });
    }
    if (dialog.open) dialog.close();
    ctx.toast(opening ? 'Opening balances saved.' : 'Balance adjustment saved.');
  }, error => {
    message.textContent = error.message;
    message.hidden = false;
  });
  dialog.showModal();
}

function balanceCard(symbol, title, value, rows) {
  return `<section class="panel balance-card"><div class="panel-heading"><div><h2>${title}</h2><p>Available balance</p></div><span class="tile-icon tone-blue">${icon(symbol, 21)}</span></div><strong class="balance-value ${value < 0 ? 'negative' : ''}">${money(value)}</strong>${value < 0 ? `<p class="inline-error negative" role="status">${icon('triangle-alert', 18)} Balance below zero. Review your adjustments and voids.</p>` : ''}<dl class="balance-details">${rows.map(([label, amount]) => `<div><dt>${label}</dt><dd>${money(amount)}</dd></div>`).join('')}</dl></section>`;
}

function movement(amount) {
  return amount === 0 ? money(0) : `<span class="${amount > 0 ? 'positive' : 'negative'}">${amount > 0 ? '+' : '−'}${money(Math.abs(amount))}</span>`;
}

export function renderBalances(ctx) {
  const { main, state, transactions, adjustments } = ctx;
  const completed = transactions.filter(transaction => transaction.status === 'completed');
  const cashIn = completed.filter(transaction => transaction.type === 'cash-in');
  const cashOut = completed.filter(transaction => transaction.type === 'cash-out');
  const manual = adjustments.filter(adjustment => adjustment.kind === 'manual');
  const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const history = adjustments.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Date &amp; time</th><th>Movement</th><th>Reason</th><th>Cash change</th><th>Wallet change</th><th>Resulting cash</th><th>Resulting wallet</th></tr></thead><tbody>${adjustments.slice().sort((a, b) => b.createdAt - a.createdAt).map(item => `<tr><td>${escapeHtml(formatDateTime(item.createdAt))}</td><td><strong>${item.kind === 'opening' ? 'Opening balances' : item.account === 'cash' ? 'Cash adjustment' : 'Wallet adjustment'}</strong></td><td class="reason-cell">${escapeHtml(item.reason || '—')}</td><td>${movement(item.cashDelta)}</td><td>${movement(item.walletDelta)}</td><td>${money(item.afterCash)}</td><td>${money(item.afterWallet)}</td></tr>`).join('')}</tbody></table></div>` : empty('No balance adjustments yet', 'Opening balances and manual movements will appear here.', 'wallet');
  const actions = `<button class="btn btn-secondary" type="button" data-balance-form="opening">${icon('settings', 18)} Opening balances</button><button class="btn btn-primary" type="button" data-balance-form="manual">${icon('plus', 19)} Adjust balance</button>`;
  main.innerHTML = `${heading('Cash &amp; Wallet Balances', 'Track the cash and GCash funds available for transactions.', actions)}
    <div class="management-grid">${balanceCard('banknote', 'Cash on hand', state.cash, [['Opening balance', state.openingCash], ['Cash received from cash-ins', sum(cashIn, 'cashDelta')], ['Cash paid out', sum(cashOut, 'payout')], ['Cash-out fees collected separately', sum(cashOut.filter(row => row.feeMode === 'separate'), 'fee')], ['Net manual adjustments', sum(manual, 'cashDelta')]])}${balanceCard('wallet', 'GCash wallet', state.wallet, [['Opening balance', state.openingWallet], ['GCash sent during cash-ins', sum(cashIn, 'amount')], ['GCash received from cash-outs', sum(cashOut, 'amount')], ['Net manual adjustments', sum(manual, 'walletDelta')]])}</div>
    <section class="panel recent-panel"><div class="panel-heading"><div><h2>Balance adjustment history</h2><p>Opening balances, top-ups, and withdrawals</p></div></div>${history}</section>`;
  for (const button of main.querySelectorAll('[data-balance-form]')) button.addEventListener('click', () => balanceForm(ctx, button.dataset.balanceForm));
}

export function renderSettings(ctx) {
  const { main, account, state, local } = ctx;
  const settings = state.settings;
  const feeInputs = settings.feeTiers.map((tier, index) => {
    const min = index === 0 ? 100 : settings.feeTiers[index - 1].max + 1;
    const label = `${money(min)} to ${money(tier.max)}`;
    const value = feeDraft?.fees[index] ?? decimal(tier.fee);
    return `<tr><th scope="row">${label}</th><td><div class="input-prefix"><span>₱</span><input type="text" name="fee-${index}" inputmode="decimal" maxlength="12" value="${escapeHtml(value)}" aria-label="Fee for ${label}" required></div></td></tr>`;
  }).join('');
  const mode = feeDraft?.mode ?? settings.cashOutFeeMode;
  const localData = local ? `<section class="panel settings-panel"><div class="panel-heading"><div><h2>Local data</h2><p>Your ledger is saved in this browser profile. Use Transaction History to export your records before clearing them.</p></div></div><button class="btn btn-danger" id="clear-local-data" type="button">Clear local data</button></section>` : '';
  const email = local ? '' : `<label class="field">Email address<input type="email" value="${escapeHtml(account?.email)}" readonly></label>`;
  const passwordReset = local ? '' : `<button class="btn btn-secondary password-button" id="send-password-reset" type="button">${icon('lock', 17)} Email password reset link</button>`;
  main.innerHTML = `${heading('Settings', local ? 'Manage your local workspace and service charges.' : 'Manage your account and service charges.')}
    <div class="settings-grid"><div class="settings-side"><section class="panel settings-panel"><div class="panel-heading"><div><h2>${local ? 'Workspace profile' : 'Account profile'}</h2>${local ? '' : '<p>Your name and sign-in email</p>'}</div><span class="tile-icon tone-blue">${icon('user', 20)}</span></div><form id="profile-settings" class="management-form"><label class="field">${local ? 'Workspace name' : 'Full name'}<input type="text" name="name" maxlength="80" value="${escapeHtml(nameDraft ?? account?.displayName)}" required></label>${email}<button class="btn btn-primary" type="submit">Save profile</button></form>${passwordReset}</section>
    <section class="panel settings-panel"><div class="panel-heading"><div><h2>Appearance</h2><p>Light and dark mode</p></div></div><button class="btn btn-secondary" type="button" data-theme-toggle aria-label="Switch theme">${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 19)}</button></section>${localData}</div>
    <section class="panel settings-panel"><div class="panel-heading"><div><h2>Service charges</h2><p>Changes apply to new transactions and corrections.</p></div><span class="tile-icon tone-blue">${icon('banknote', 21)}</span></div><form id="fee-settings" class="management-form"><label class="field">Cash-out fee method<select name="mode"><option value="deduct" ${mode === 'deduct' ? 'selected' : ''}>Deduct from cash payout</option><option value="separate" ${mode === 'separate' ? 'selected' : ''}>Collect separately in cash</option></select></label><div class="table-wrap fee-table"><table class="data-table"><thead><tr><th>Transaction amount</th><th>Service charge</th></tr></thead><tbody>${feeInputs}</tbody></table></div><div class="form-actions"><button class="btn btn-secondary" id="default-fees" type="button">Restore default fees</button><button class="btn btn-primary" type="submit">Save service charges</button></div></form></section></div>`;

  const profile = main.querySelector('#profile-settings');
  profile.elements.name.addEventListener('input', event => { nameDraft = event.target.value; });
  bindForm(profile, async data => {
    await ctx.updateAccount(data.get('name'));
    nameDraft = undefined;
    ctx.toast('Profile saved.');
    ctx.rerender();
  });
  const reset = main.querySelector('#send-password-reset');
  reset?.addEventListener('click', async () => {
    reset.disabled = true;
    try {
      await ctx.resetPassword();
      ctx.toast('Password reset email sent.');
    } catch (error) {
      ctx.toast(ctx.friendlyError(error), 'error');
    } finally {
      reset.disabled = false;
    }
  });
  main.querySelector('#clear-local-data')?.addEventListener('click', ctx.confirmLocalReset);
  const fees = main.querySelector('#fee-settings');
  const readFees = data => settings.feeTiers.map((_, index) => data.get(`fee-${index}`));
  fees.addEventListener('input', () => {
    const data = new FormData(fees);
    feeDraft = { mode: data.get('mode'), fees: readFees(data) };
  });
  main.querySelector('#default-fees').addEventListener('click', () => {
    DEFAULT_FEE_TIERS.forEach((tier, index) => { fees.elements[`fee-${index}`].value = decimal(tier.fee); });
    fees.dispatchEvent(new Event('input'));
  });
  bindForm(fees, async data => {
    const values = readFees(data);
    const feeTiers = validateFeeTiers(settings.feeTiers.map((tier, index) => ({ max: tier.max, fee: parseMoney(values[index]) })));
    await ctx.saveSettings({ cashOutFeeMode: data.get('mode'), feeTiers });
    feeDraft = undefined;
    ctx.toast('Service charges saved.');
  });
}
