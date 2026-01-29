const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const Cart = require("../models/Cart");
const paypal = require("../services/paypal");
const db = require("../db");
const stripeSdk = require("stripe");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripe = STRIPE_SECRET_KEY ? stripeSdk(STRIPE_SECRET_KEY) : null;

const REQUIRED_REASON_MSG = "Refund reason is required.";

function parseAmount(amountStr) {
    if (!amountStr) return null;
    const num = Number(amountStr);
    if (Number.isNaN(num) || num <= 0) return null;
    return num;
}

function flashAndBack(req, res, type, msg, redirectTo = "/refunds") {
    req.flash(type, msg);
    return res.redirect(redirectTo);
}

function markOrderRefunded(orderId, method, ref, payerEmail, status = "REFUNDED") {
    return new Promise((resolve, reject) => {
        db.query(
            `UPDATE orders 
             SET payment_status=?,
                 payment_method=?,
                 payment_ref=COALESCE(?, payment_ref),
                 payer_email=COALESCE(?, payer_email)
             WHERE id=?`,
            [status, method, ref || null, payerEmail || null, orderId],
            (err) => (err ? reject(err) : resolve())
        );
    });
}

function setRefundStatus(orderId, status, reason) {
    return new Promise((resolve, reject) => {
        db.query(
            `UPDATE orders 
             SET refundStatus=?, 
                 refundReason=COALESCE(?, refundReason),
                 refundRequestedAt = CASE 
                    WHEN ?='REQUESTED' THEN NOW() 
                    ELSE refundRequestedAt END,
                 refundReviewedAt = CASE 
                    WHEN ? IN ('APPROVED','REJECTED') THEN NOW() 
                    ELSE refundReviewedAt END
             WHERE id=?`,
            [status, reason || null, status, status, orderId],
            (err)=> err ? reject(err) : resolve()
        );
    });
}

async function ensureLatestTransaction(orderId) {
    return new Promise((resolve) =>
        Transaction.getLatestByOrder(orderId, (err, row) => resolve(row || null))
    );
}

const RefundController = {
    // Customer-initiated refund request (records a pending request for admin review)
    async request(req, res) {
        const orderId = req.params.id;
        const reason = (req.body.reason || "").trim();
        const mode = "full"; // users only supply reason; admin decides full/partial

        if (!reason) return flashAndBack(req, res, "error", REQUIRED_REASON_MSG);

        const userId = req.session.user?.id;
        if (!userId) return flashAndBack(req, res, "error", "Please log in first.");

        const order = await new Promise((resolve, reject) =>
            Order.getById(orderId, (err, o) => (err ? reject(err) : resolve(o)))
        ).catch((e) => {
            console.error("Refund request get order error:", e);
            return null;
        });

        if (!order || Number(order.user_id) !== Number(userId)) {
            return flashAndBack(req, res, "error", "Order not found.");
        }

        // Enforce 7-day refund window
        const orderTime = order.order_date ? new Date(order.order_date).getTime() : 0;
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
        if (!orderTime || (Date.now() - orderTime) > sevenDaysMs) {
            return flashAndBack(req, res, "error", "Refund window (7 days) has passed for this order.");
        }

        if (!["STRIPE", "PAYPAL"].includes(order.payment_method || "")) {
            return flashAndBack(req, res, "error", "Refunds available for Stripe/PayPal only.");
        }

        const latestTxn = await new Promise((resolve) =>
            Transaction.getLatestByOrder(orderId, (err, row) => resolve(row || null))
        );

        if (latestTxn && latestTxn.status === "REFUND_REQUESTED") {
            return flashAndBack(req, res, "error", "A refund request is already pending for this order. Please wait for admin to approve/reject.");
        }

        if (!["PAID", "PARTIAL"].includes((order.payment_status || "").toUpperCase())) {
            return flashAndBack(req, res, "error", "Only paid orders can request refunds.");
        }

        const requestAmount =
            mode === "partial" ? Number(order.total_amount) / 2 : order.total_amount;

        await new Promise((resolve) =>
            Transaction.create(
                {
                    orderId: String(orderId),
                    payerId: order.payment_ref,
                    payerEmail: order.payer_email,
                    amount: requestAmount,
                    currency: "SGD",
                    status: "REFUND_REQUESTED",
                    time: new Date(),
                    paymentMethod: order.payment_method,
                    paymentRef: order.payment_ref,
                    refundStatus: `Request (${mode.toUpperCase()}): ${reason}`
                },
                () => resolve()
            )
        );

        await setRefundStatus(orderId, "REQUESTED", reason);

        req.flash("success", "Refund request submitted. Admin will review it.");
        return res.redirect("/refunds");
    },

    // Admin marks a refund as processing (full/partial) without calling gateways
    async processManual(req, res) {
        const orderId = req.params.id;
        const mode = (req.body.mode || "full").toLowerCase();
        const reason = (req.body.reason || "").trim();
        const amountInput = req.body.amount ? Number(req.body.amount) : null;

        const order = await new Promise((resolve, reject) =>
            Order.getById(orderId, (err, o) => (err ? reject(err) : resolve(o)))
        ).catch((e) => {
            console.error("Process refund get order error:", e);
            return null;
        });
        if (!order) return flashAndBack(req, res, "error", "Order not found.", "/admin/orders");

        const latestTxn = await ensureLatestTransaction(orderId);
        const hasPending =
            (latestTxn && latestTxn.status === "REFUND_REQUESTED") ||
            (order.refundStatus === "REQUESTED");
        if (!hasPending) {
            return flashAndBack(req, res, "error", "No pending refund request to process.", "/admin/orders");
        }

        const totalPaid = Number(order.total_amount || latestTxn?.amount || 0);
        let amount = mode === "partial" ? totalPaid / 2 : totalPaid;
        if (amountInput && amountInput > 0) amount = amountInput;
        if (amount > totalPaid) {
            return flashAndBack(req, res, "error", "Refund amount exceeds paid total.", "/admin/orders");
        }

        const note = reason || latestTxn.refund_status || "Processing refund";

        await markOrderRefunded(orderId, order.payment_method, order.payment_ref, order.payer_email, "REFUNDED");
        await setRefundStatus(orderId, "APPROVED", `${mode.toUpperCase()}: ${note} (SGD ${amount.toFixed(2)})`);

        await new Promise((resolve) =>
            Transaction.create(
                {
                    orderId: String(orderId),
                    payerId: order.payment_ref,
                    payerEmail: order.payer_email,
                    amount,
                    currency: latestTxn.currency || "SGD",
                    status: "REFUNDED",
                    time: new Date(),
                    paymentMethod: order.payment_method,
                    paymentRef: order.payment_ref,
                    refundStatus: `Approved (${mode.toUpperCase()}) SGD ${amount.toFixed(2)}: ${note}`
                },
                () => resolve()
            )
        );

        req.flash("success", "Refund approved.");
        return res.redirect("/admin/orders");
    },

    async stripe(req, res) {
        if (!stripe) return flashAndBack(req, res, "error", "Stripe not configured.");

        const orderId = req.params.id;
        const reason = (req.body.reason || "").trim();
        const amountNum = parseAmount(req.body.amount);

        if (!reason) return flashAndBack(req, res, "error", REQUIRED_REASON_MSG);

        const order = await new Promise((resolve, reject) =>
            Order.getById(orderId, (err, o) => (err ? reject(err) : resolve(o)))
        ).catch((e) => {
            console.error("Stripe refund get order error:", e);
            return null;
        });

        if (!order) return flashAndBack(req, res, "error", "Order not found.", "/admin/orders");
        if (order.payment_method !== "STRIPE" || !order.payment_ref) {
            return flashAndBack(req, res, "error", "Order is not a Stripe payment.", "/admin/orders");
        }

        const effectiveStatus =
            amountNum && amountNum < Number(order.total_amount)
                ? "PARTIAL"
                : "REFUNDED";

        try {
            const params = {
                payment_intent: order.payment_ref,
                metadata: { reason }
            };
            if (amountNum) params.amount = Math.round(amountNum * 100);

            const refund = await stripe.refunds.create(params);

            await markOrderRefunded(orderId, "STRIPE", order.payment_ref, order.payer_email, effectiveStatus);
            await setRefundStatus(orderId, "APPROVED", `${effectiveStatus}: ${reason}`);

            await new Promise((resolve) =>
                Transaction.create(
                    {
                        orderId: String(orderId),
                        payerId: order.payment_ref,
                        payerEmail: order.payer_email,
                        amount: amountNum || order.total_amount,
                        currency: "SGD",
                        status: refund.status || effectiveStatus,
                        time: new Date(),
                        paymentMethod: "STRIPE",
                        paymentRef: order.payment_ref,
                        refundId: refund.id,
                        refundStatus: (refund.status || effectiveStatus) + (reason ? ` (${reason})` : "")
                    },
                    () => resolve()
                )
            );

            // Optionally clear cart (safety if pending items linger)
            await new Promise((resolve) =>
                Cart.clearCart(order.user_id, () => resolve())
            );

            req.flash("success", `Stripe refund submitted (${refund.status}).`);
            return res.redirect("back");
        } catch (err) {
            console.error("Stripe refund error:", err);
            return flashAndBack(req, res, "error", err.message || "Stripe refund failed.", "/admin/orders");
        }
    },

    async paypal(req, res) {
        const orderId = req.params.id;
        const reason = (req.body.reason || "").trim();
        const amountNum = parseAmount(req.body.amount);

        if (!reason) return flashAndBack(req, res, "error", REQUIRED_REASON_MSG);

        const order = await new Promise((resolve, reject) =>
            Order.getById(orderId, (err, o) => (err ? reject(err) : resolve(o)))
        ).catch((e) => {
            console.error("PayPal refund get order error:", e);
            return null;
        });

        if (!order) return flashAndBack(req, res, "error", "Order not found.", "/admin/orders");
        if (order.payment_method !== "PAYPAL") {
            return flashAndBack(req, res, "error", "Order is not a PayPal payment.", "/admin/orders");
        }

        const effectiveStatus =
            amountNum && amountNum < Number(order.total_amount)
                ? "PARTIAL"
                : "REFUNDED";

        const txn = await ensureLatestTransaction(orderId);
        const captureId = txn?.capture_id;
        if (!captureId) {
            return flashAndBack(req, res, "error", "No PayPal capture found for this order.", "/admin/orders");
        }

        try {
            const refund = await paypal.refundCapture(
                captureId,
                amountNum ? amountNum.toFixed(2) : undefined
            );

            await markOrderRefunded(orderId, "PAYPAL", order.payment_ref, order.payer_email, effectiveStatus);
            await setRefundStatus(orderId, "APPROVED", `${effectiveStatus}: ${reason}`);

            await new Promise((resolve) =>
                Transaction.create(
                    {
                        orderId: String(orderId),
                        payerId: txn?.payerId || order.payment_ref,
                        payerEmail: order.payer_email,
                        amount: amountNum || order.total_amount,
                        currency: "SGD",
                        status: refund.status || effectiveStatus,
                        time: new Date(),
                        paymentMethod: "PAYPAL",
                        paymentRef: order.payment_ref,
                        refundId: refund?.id || refund?.refund_id || null,
                        refundStatus: (refund.status || effectiveStatus) + (reason ? ` (${reason})` : "")
                    },
                    () => resolve()
                )
            );

            await new Promise((resolve) =>
                Cart.clearCart(order.user_id, () => resolve())
            );

            req.flash("success", `PayPal refund submitted (${refund.status || 'REFUNDED'}).`);
            return res.redirect("back");
        } catch (err) {
            console.error("PayPal refund error:", err);
            return flashAndBack(req, res, "error", err.message || "PayPal refund failed.", "/admin/orders");
        }
    }

    ,

    async reject(req, res) {
        const orderId = req.params.id;
        const reason = (req.body.reason || "").trim();
        if (!reason) return flashAndBack(req, res, "error", "Rejection reason is required.");

        const order = await new Promise((resolve, reject) =>
            Order.getById(orderId, (err, o) => (err ? reject(err) : resolve(o)))
        ).catch((e) => {
            console.error("Reject refund get order error:", e);
            return null;
        });
        if (!order) return flashAndBack(req, res, "error", "Order not found.");

        const latestTxn = await new Promise((resolve) =>
            Transaction.getLatestByOrder(orderId, (err, row) => resolve(row || null))
        );
        const hasPending =
            (latestTxn && latestTxn.status === "REFUND_REQUESTED") ||
            (order.refundStatus === "REQUESTED");
        if (!hasPending) {
            return flashAndBack(req, res, "error", "No pending refund request to reject.", "/admin/orders");
        }

        await new Promise((resolve) =>
            Transaction.create(
                {
                    orderId: String(orderId),
                    payerId: order.payment_ref,
                    payerEmail: order.payer_email,
                    amount: latestTxn.amount,
                    currency: latestTxn.currency || "SGD",
                    status: "REFUND_REJECTED",
                    time: new Date(),
                    paymentMethod: order.payment_method,
                    paymentRef: order.payment_ref,
                    refundStatus: `Rejected: ${reason}`
                },
                () => resolve()
            )
        );

        await setRefundStatus(orderId, "REJECTED", reason);

        req.flash("success", "Refund request rejected.");
        return res.redirect("/admin/orders");
    }
};

module.exports = RefundController;
