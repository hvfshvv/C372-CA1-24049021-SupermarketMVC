const db = require("./dbAsync");

async function ensureWallet(userId) {
  await db.query(
    "INSERT IGNORE INTO wallets (userId, balance, updatedAt) VALUES (?, 0, NOW())",
    [userId]
  );
}

async function creditWallet({ userId, amount, currency = "SGD", referenceType, referenceId }) {
  await db.begin();
  try {
    await ensureWallet(userId);
    await db.query(
      "INSERT INTO wallet_ledger (userId, type, amount, currency, referenceType, referenceId) VALUES (?, 'CREDIT', ?, ?, ?, ?)",
      [userId, amount, currency, referenceType || null, referenceId || null]
    );
    await db.query(
      "UPDATE wallets SET balance = balance + ?, updatedAt = NOW() WHERE userId=?",
      [amount, userId]
    );
    await db.commit();
    return true;
  } catch (err) {
    await db.rollback();
    throw err;
  }
}

module.exports = { ensureWallet, creditWallet };
