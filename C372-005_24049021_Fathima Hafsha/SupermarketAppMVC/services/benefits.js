const SubscriptionService = require("./subscriptionService");

async function computeTotalWithBenefits(userId, cart) {
  const base = (cart || []).reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
  let deliveryFee = 2.0;
  let discount = 0;
  let plan = "NONE";

  const sub = await SubscriptionService.getLatestForUser(userId).then(s => SubscriptionService.renewIfDue(s));

  if (SubscriptionService.isActive(sub)) {
    plan = sub.plan;
    if (sub.plan === "PREMIUM") {
      deliveryFee = base >= 5 ? 0 : 2.0;
      discount = 1.5; // fixed dollar off
    } else {
      // BASIC
      deliveryFee = base >= 10 ? 0 : 2.0;
    }
  } else {
    // No subscription: default delivery threshold 10
    deliveryFee = base >= 10 ? 0 : 2.0;
  }

  const total = Math.max(0.5, base + deliveryFee - discount);
  return { total, base, deliveryFee, discount, plan };
}

module.exports = { computeTotalWithBenefits };
