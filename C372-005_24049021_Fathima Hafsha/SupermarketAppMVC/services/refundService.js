const db = require("./dbAsync");
const stripeSdk = require("stripe");
const paypalSvc = require("../services/paypal");
const Order = require("../models/Order");
const { creditWallet } = require("./walletService");
const Transaction = require("../models/Transaction");

const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecret ? stripeSdk(stripeSecret) : null;

async function getOrder(orderId) {
  return new Promise((resolve, reject) =>
    Order.getById(orderId, (e, o) => (e ? reject(e) : resolve(o)))
  );
}

async function getRefundedSum(orderId) {
  const rows = await db.query(
    "SELECT COALESCE(SUM(amount),0) AS sumAmt FROM refunds WHERE orderId=? AND status IN ('SUCCEEDED')",
    [orderId]
  );
  return Number(rows[0]?.sumAmt || 0);
}

async function createRequest({ orderId, userId, amount, currency = "SGD", reason }) {
  const existing = await db.query(
    "SELECT id FROM refunds WHERE orderId=? AND status='REQUESTED' LIMIT 1",
    [orderId]
  );
  if (existing.length) return existing[0].id;
  const res = await db.query(
    "INSERT INTO refunds (orderId, userId, amount, currency, method, reason, status) VALUES (?, ?, ?, ?, 'WALLET', ?, 'REQUESTED')",
    [orderId, userId, amount, currency, reason]
  );
  return res.insertId;
}

async function approveWallet(refundId) {
  await db.begin();
  try {
    const rows = await db.query("SELECT * FROM refunds WHERE id=? FOR UPDATE", [refundId]);
    const refund = rows[0];
    if (!refund) throw new Error("Refund not found");
    if (["SUCCEEDED", "FAILED"].includes(refund.status)) {
      await db.rollback();
      return refund;
    }
    const order = await getOrder(refund.orderId);
    const refunded = await getRefundedSum(refund.orderId);
    const remaining = Number(order.total_amount) - refunded;
    const amt = Math.min(Number(refund.amount), remaining);
    if (amt <= 0) throw new Error("Nothing refundable");

    await creditWallet({
      userId: refund.userId,
      amount: amt,
      referenceType: "REFUND",
      referenceId: refundId,
    });

    await db.query(
      "UPDATE refunds SET status='SUCCEEDED', updatedAt=NOW(), method='WALLET' WHERE id=?",
      [refundId]
    );

    const newRefunded = refunded + amt;
    const newStatus = newRefunded >= Number(order.total_amount) ? "REFUNDED" : "PARTIAL";
    await db.query("UPDATE orders SET payment_status=?, refundStatus='SUCCEEDED' WHERE id=?", [
      newStatus,
      order.id,
    ]);

    await new Promise((resolve) =>
      Transaction.create(
        {
          orderId: String(order.id),
          payerId: "WALLET",
          payerEmail: order.payer_email,
          amount: amt,
          currency: "SGD",
          status: "REFUND",
          time: new Date(),
          paymentMethod: "WALLET",
          paymentRef: "WALLET",
          refundId: refundId,
          refundStatus: "SUCCEEDED",
        },
        () => resolve()
      )
    );

    await db.commit();
    return { ...refund, status: "SUCCEEDED", amount: amt };
  } catch (err) {
    await db.rollback();
    throw err;
  }
}

async function approveStripe(refundId, amountOverride) {
  if (!stripe) throw new Error("Stripe not configured");
  const [refund] = await db.query("SELECT * FROM refunds WHERE id=?", [refundId]);
  if (!refund) throw new Error("Refund not found");
  if (["SUCCEEDED", "FAILED"].includes(refund.status)) return refund;

  const order = await getOrder(refund.orderId);
  const refunded = await getRefundedSum(refund.orderId);
  const remaining = Number(order.total_amount) - refunded;
  const amt = Math.min(amountOverride || Number(refund.amount), remaining);
  if (amt <= 0) throw new Error("Nothing refundable");

  try {
    const stripeRefund = await stripe.refunds.create({
      payment_intent: order.payment_ref,
      amount: Math.round(amt * 100),
      metadata: { refundId },
    });

    await db.query(
      "UPDATE refunds SET status='SUCCEEDED', gatewayRefundId=?, method='STRIPE', amount=? WHERE id=?",
      [stripeRefund.id, amt, refundId]
    );

    const newRefunded = refunded + amt;
    const newStatus = newRefunded >= Number(order.total_amount) ? "REFUNDED" : "PARTIAL";
    await db.query("UPDATE orders SET payment_status=?, refundStatus='SUCCEEDED' WHERE id=?", [
      newStatus,
      order.id,
    ]);

    await new Promise((resolve) =>
      Transaction.create(
        {
          orderId: String(order.id),
          payerId: order.payment_ref,
          payerEmail: order.payer_email,
          amount: amt,
          currency: "SGD",
          status: "REFUND",
          time: new Date(),
          paymentMethod: "STRIPE",
          paymentRef: order.payment_ref,
          refundId: refundId,
          refundStatus: stripeRefund.status || "SUCCEEDED",
        },
        () => resolve()
      )
    );

    return { ...refund, status: "SUCCEEDED", gatewayRefundId: stripeRefund.id, amount: amt };
  } catch (err) {
    await db.query("UPDATE refunds SET status='FAILED', updatedAt=NOW() WHERE id=?", [refundId]);
    throw err;
  }
}

async function approvePayPal(refundId, captureId, amountOverride) {
  const [refund] = await db.query("SELECT * FROM refunds WHERE id=?", [refundId]);
  if (!refund) throw new Error("Refund not found");
  if (["SUCCEEDED", "FAILED"].includes(refund.status)) return refund;

  const order = await getOrder(refund.orderId);
  const refunded = await getRefundedSum(refund.orderId);
  const remaining = Number(order.total_amount) - refunded;
  const amt = Math.min(amountOverride || Number(refund.amount), remaining);
  if (amt <= 0) throw new Error("Nothing refundable");

  try {
    const payRes = await paypalSvc.refundCapture(captureId, amt.toFixed(2));
    const gatewayId = payRes?.id || payRes?.refund_id || null;

    await db.query(
      "UPDATE refunds SET status='SUCCEEDED', gatewayRefundId=?, method='PAYPAL', amount=? WHERE id=?",
      [gatewayId, amt, refundId]
    );

    const newRefunded = refunded + amt;
    const newStatus = newRefunded >= Number(order.total_amount) ? "REFUNDED" : "PARTIAL";
    await db.query("UPDATE orders SET payment_status=?, refundStatus='SUCCEEDED' WHERE id=?", [
      newStatus,
      order.id,
    ]);

    await new Promise((resolve) =>
      Transaction.create(
        {
          orderId: String(order.id),
          payerId: order.payment_ref,
          payerEmail: order.payer_email,
          amount: amt,
          currency: "SGD",
          status: "REFUND",
          time: new Date(),
          paymentMethod: "PAYPAL",
          paymentRef: order.payment_ref,
          refundId: refundId,
          refundStatus: payRes?.status || "SUCCEEDED",
        },
        () => resolve()
      )
    );

    return { ...refund, status: "SUCCEEDED", gatewayRefundId: gatewayId, amount: amt };
  } catch (err) {
    await db.query("UPDATE refunds SET status='FAILED', updatedAt=NOW() WHERE id=?", [refundId]);
    throw err;
  }
}

module.exports = {
  createRequest,
  approveWallet,
  approveStripe,
  approvePayPal,
  getRefundedSum,
};
