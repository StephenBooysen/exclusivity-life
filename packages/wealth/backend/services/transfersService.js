'use strict';

const crypto = require('node:crypto');

const DEBT_TYPES = new Set(['credit_card', 'loan', 'home_loan']);

/** A payment into a debt account reduces what's owed; everywhere else, a transfer just adds/subtracts balance. */
function applyDelta(account, delta) {
  return DEBT_TYPES.has(account.type) ? account.balance - delta : account.balance + delta;
}

function createTransfersService({ accounts, transactions, versionedCache, activity }) {
  async function create({ fromAccountId, toAccountId, amount, date, note }) {
    if (!fromAccountId || !toAccountId) throw new Error('fromAccountId and toAccountId are required');
    if (fromAccountId === toAccountId) throw new Error('Cannot transfer an account to itself');
    if (!(amount > 0)) throw new Error('Transfer amount must be greater than zero');

    const [fromAccount, toAccount] = await Promise.all([accounts.get(fromAccountId), accounts.get(toAccountId)]);
    if (!fromAccount) throw new Error('Source account not found');
    if (!toAccount) throw new Error('Destination account not found');
    if (fromAccount.type !== 'cash') throw new Error('Transfers must come from a cash account');
    if (toAccount.type !== 'cash' && !DEBT_TYPES.has(toAccount.type)) {
      throw new Error('Transfers can only go to a cash account or a debt account');
    }

    const transferId = crypto.randomUUID();
    const transferDate = date || new Date().toISOString().slice(0, 10);

    // The file-backed store does a whole-container read/modify/write with no locking, so writes
    // to the same container must happen one at a time — two concurrent `accounts.update()` calls
    // would race and the second write would silently clobber the first with a stale read.
    const outRecord = await transactions.create({
      accountId: fromAccountId,
      kind: 'transfer',
      direction: 'out',
      counterAccountId: toAccountId,
      transferId,
      date: transferDate,
      note: note || `Transfer to ${toAccount.name}`,
      category: null,
      amount
    });
    const inRecord = await transactions.create({
      accountId: toAccountId,
      kind: 'transfer',
      direction: 'in',
      counterAccountId: fromAccountId,
      transferId,
      date: transferDate,
      note: note || `Transfer from ${fromAccount.name}`,
      category: null,
      amount
    });

    await accounts.update(fromAccountId, { balance: applyDelta(fromAccount, -amount) });
    await accounts.update(toAccountId, { balance: applyDelta(toAccount, amount) });

    await versionedCache.bump();
    await activity.log(
      'transfer.created',
      `Transferred ${amount} from ${fromAccount.name} to ${toAccount.name}`,
      { transferId, fromAccountId, toAccountId, amount }
    );

    return { transferId, out: outRecord, in: inRecord };
  }

  return { create };
}

module.exports = { createTransfersService };
