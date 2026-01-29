const db = require("./dbAsync");
const Subscription = require("../models/Subscription");

function isActive(sub) {
  if (!sub) return false;
  const now = Date.now();
  const endTs = sub.endDate ? new Date(sub.endDate).getTime() : null;
  // treat cancelled-at-period-end as active until endDate
  if (sub.status === "CANCELLED" && endTs && endTs > now) return true;
  if (sub.status !== "ACTIVE") return false;
  if (endTs && endTs < now) return false;
  return true;
}

async function getLatestForUser(userId) {
  return new Promise((resolve) => Subscription.getByUser(userId, (e, s) => resolve(s || null)));
}

async function renewIfDue(sub) {
  if (!sub) return null;
  if (sub.status !== "ACTIVE") return sub;
  if (!sub.endDate) return sub;
  const expired = new Date(sub.endDate).getTime() < Date.now();
  if (!expired) return sub;
  if (sub.autoRenew && !sub.cancelAtPeriodEnd) {
    await db.query("UPDATE subscriptions SET endDate=DATE_ADD(endDate, INTERVAL 1 MONTH) WHERE id=?", [sub.id]);
    return { ...sub, endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000), status: "ACTIVE" };
  }
  await db.query("UPDATE subscriptions SET status='EXPIRED' WHERE id=?", [sub.id]);
  return { ...sub, status: "EXPIRED" };
}

async function create(userId, plan, autoRenew) {
  return new Promise((resolve, reject) =>
    Subscription.create(userId, plan, autoRenew, (e, r) => (e ? reject(e) : resolve(r)))
  );
}

async function cancelImmediate(id) {
  await db.query("UPDATE subscriptions SET status='CANCELLED', endDate=NOW(), autoRenew=0 WHERE id=?", [id]);
}

async function cancelAtPeriodEnd(id) {
  await db.query("UPDATE subscriptions SET cancelAtPeriodEnd=1, autoRenew=0 WHERE id=?", [id]);
}

module.exports = { isActive, getLatestForUser, renewIfDue, create, cancelImmediate, cancelAtPeriodEnd };
