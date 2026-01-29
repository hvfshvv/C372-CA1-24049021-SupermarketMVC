const SubscriptionService = require("./subscriptionService");

async function computeTotalWithBenefits(userId, cart) {
  const base = (cart || []).reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
  const defaultDelivery = 2.0;
  let deliveryFee = defaultDelivery;
  let discount = 0;
  let plan = "NONE";

  const sub = await SubscriptionService.getLatestForUser(userId).then(s => SubscriptionService.renewIfDue(s));

  const planCode = (sub?.plan || "NONE").toUpperCase();

  if (SubscriptionService.isActive(sub)) {
    plan = planCode;
    if (planCode === "PREMIUM") {
      deliveryFee = base >= 5 ? 0 : defaultDelivery;
      discount = 1.5; // fixed dollar off
    } else {
      // BASIC or anything else active
      deliveryFee = base >= 10 ? 0 : defaultDelivery;
    }
  } else {
    // No subscription: still waive delivery for bigger baskets
    deliveryFee = base >= 10 ? 0 : defaultDelivery;
  }

  const total = Math.max(0.5, base + deliveryFee - discount);
  return { total, base, deliveryFee, discount, plan };
}

module.exports = { computeTotalWithBenefits };
