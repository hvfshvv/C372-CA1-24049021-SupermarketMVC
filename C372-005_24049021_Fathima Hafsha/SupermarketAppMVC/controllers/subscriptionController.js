const Subscription = require("../models/Subscription");
const SubscriptionService = require("../services/subscriptionService");
const paypal = require("../services/paypal");
const { createOrderFromCart } = require("../services/subscriptionService"); // placeholder not used

const PLAN_PRICING = {
  BASIC: 4.99,
  PREMIUM: 9.99
};

const SubscriptionController = {
  view: async (req, res) => {
    const sub = await SubscriptionService.getLatestForUser(req.session.user.id).then(s => SubscriptionService.renewIfDue(s));
    res.render("subscription", {
      sub,
      user: req.session.user,
      pricing: PLAN_PRICING,
      paypalClientId: process.env.PAYPAL_CLIENT_ID || ""
    });
  },

  subscribe: (req, res) => {
    const plan = req.body.plan === "PREMIUM" ? "PREMIUM" : "BASIC";
    const auto = req.body.autoRenew ? 1 : 0;
    SubscriptionService.create(req.session.user.id, plan, auto)
      .then(() => {
        req.flash("success", "Subscription created.");
        res.redirect("/subscription");
      })
      .catch((err) => {
        console.error(err);
        req.flash("error", "Subscribe failed");
        res.redirect("/subscription");
    });
  },

  createPaypalOrder: async (req, res) => {
    try {
      const plan = req.body.plan === "PREMIUM" ? "PREMIUM" : "BASIC";
      const amount = PLAN_PRICING[plan] || PLAN_PRICING.BASIC;
      const ppOrder = await paypal.createOrder(amount.toFixed(2));
      req.session.subPending = { plan, autoRenew: req.body.autoRenew ? 1 : 0, paypalOrderId: ppOrder.id };
      return res.json({ id: ppOrder.id });
    } catch (err) {
      console.error("Subscription PayPal create error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  capturePaypalOrder: async (req, res) => {
    try {
      const orderID = req.body.orderID;
      if (!req.session.subPending || req.session.subPending.paypalOrderId !== orderID) {
        return res.status(400).json({ error: "No pending subscription order" });
      }
      const capture = await paypal.captureOrder(orderID);
      await SubscriptionService.create(
        req.session.user.id,
        req.session.subPending.plan,
        req.session.subPending.autoRenew
      );
      req.session.subPending = null;
      return res.json({ success: true });
    } catch (err) {
      console.error("Subscription PayPal capture error:", err);
      return res.status(500).json({ error: err.message });
    }
  },

  cancel: (req, res) => {
    const mode = req.body.mode === "end" ? "end" : "now";
    const id = req.body.id;
    const action = mode === "end" ? SubscriptionService.cancelAtPeriodEnd : SubscriptionService.cancelImmediate;
    action(id)
      .then(() => {
        req.flash("success", "Subscription cancelled.");
        res.redirect("/subscription");
      })
      .catch((err) => {
        console.error(err);
        req.flash("error", "Cancel failed");
        res.redirect("/subscription");
      });
  },

  adminList: (req, res) => {
    Subscription.adminAll((err, subs) => {
      if (err) return res.status(500).send("Failed to load subscriptions");
      res.render("adminSubscriptions", { subs: subs || [], user: req.session.user });
    });
  }
};

module.exports = SubscriptionController;
