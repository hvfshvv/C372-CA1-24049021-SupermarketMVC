const crypto = require("crypto");
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const Transaction = require("../models/Transaction");
const netsService = require("../services/nets");
const { computeTotalWithBenefits } = require("../services/benefits");
const { applyPromo } = require("../services/promoService");

// Local helper (mirrors app.js helper) to create order from cart with payment metadata
async function createOrderFromCart(userId, options = {}) {
    const {
        paymentMethod = "UNKNOWN",
        paymentStatus = "PENDING",
        paymentRef = null,
        payerEmail = null,
        paidAt = null,
        deliveryType = "NOW",
        scheduledAt = null,
        etaMin = null,
        etaMax = null,
        promoCode = null,
        promoDiscount = 0,
        clearCart = true,
        forceTotal = null,
    } = options;

    const cart = await new Promise((resolve, reject) => {
        Cart.getCart(userId, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });
    if (!cart.length) throw new Error("Cart empty");

    const computed = cart.reduce(
        (sum, item) => sum + Number(item.price) * Number(item.quantity),
        0
    );
    const total = forceTotal !== null ? forceTotal : computed;

    const orderId = await new Promise((resolve, reject) => {
        Order.create(
            userId,
            total,
            { 
                paymentMethod, 
                paymentStatus, 
                paymentRef, 
                payerEmail, 
                paidAt,
                deliveryType,
                scheduledAt,
                etaMin,
                etaMax,
                promoCode,
                promoDiscount
            },
            (err, id) => (err ? reject(err) : resolve(id))
        );
    });

    for (const item of cart) {
        await new Promise((resolve, reject) => {
            Order.addItem(
                orderId,
                item.product_id,
                item.productName,
                item.price,
                item.quantity,
                (err) => (err ? reject(err) : resolve())
            );
        });
    }

    if (clearCart) {
        await new Promise((resolve, reject) =>
            Cart.clearCart(userId, (err) => (err ? reject(err) : resolve()))
        );
    }

    return { orderId, cart, total };
}

// POST /api/nets/qr-request
async function requestQr(req, res) {
    try {
        const userId = req.session.user.id;
        const { promoCode, deliveryType, scheduledAt, selectedIndices } = req.body || {};

        console.log("NETS requestQr handler - userId:", userId, "promoCode:", promoCode, "deliveryType:", deliveryType);

        const cart = await new Promise((resolve, reject) => {
            Cart.getCart(userId, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });

        if (!cart.length) {
            console.warn("NETS requestQr - Cart is empty");
            return res.status(400).json({ error: "Cart is empty" });
        }

        // Apply promo validation
        let promoDiscount = 0;
        if (promoCode) {
            const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
            const promoResult = await applyPromo(promoCode, subtotal);
            if (!promoResult.applied) {
                return res.status(400).json({ error: promoResult.message });
            }
            promoDiscount = promoResult.discount;
        }

        // Validate delivery timing
        if (deliveryType === 'SCHEDULED' && scheduledAt) {
            const schedTime = new Date(scheduledAt);
            const minTime = new Date(Date.now() + 45 * 60000);
            if (schedTime < minTime) {
                return res.status(400).json({ error: 'Scheduled time must be 45+ mins from now' });
            }
        }

        const benefits = await computeTotalWithBenefits(userId, cart);
        let total = benefits.total - promoDiscount;

        console.log("NETS requestQr - Cart total:", total);

        // NETS sandbox prefers integer dollars; round for safety
        const netsAmount = Math.max(1, Math.round(total));
        // NETS sandbox: use correct txn_id format with UUID
        const txnId = `sandbox_nets|m|${crypto.randomUUID()}`;

        console.log("NETS requestQr - Calling netsService.requestQr with:", { txnId, netsAmount });

        const qr = await netsService.requestQr({
            txnId,
            amount: netsAmount,
            notifyMobile: 0,
        });

        console.log("NETS requestQr - QR generated successfully, txnRef:", qr.txnRetrievalRef);

        // Calculate ETA for NOW deliveries
        let etaMin = null, etaMax = null;
        if (deliveryType === 'NOW') {
            etaMin = 45;
            etaMax = 60;
        }

        req.session.netsPending = {
            txnId,
            txnRetrievalRef: qr.txnRetrievalRef,
            amount: total,
            promoCode,
            promoDiscount,
            deliveryType: deliveryType || 'NOW',
            scheduledAt: scheduledAt || null,
            etaMin,
            etaMax
        };

        return res.json({
            qrDataUrl: qr.qrDataUrl,
            txn_retrieval_ref: qr.txnRetrievalRef,
        });
    } catch (err) {
        console.error("NETS requestQr error:", {
            message: err.message,
            stack: err.stack,
            responseStatus: err.response?.status,
        });
        
        const errorMessage = err?.message || err?.toString?.() || "Failed to create NETS QR";
        return res
            .status(500)
            .json({ error: errorMessage });
    }
}

// GET /api/nets/query
async function queryStatus(req, res) {
    const { txn_retrieval_ref } = req.query;
    if (!txn_retrieval_ref) {
        return res.status(400).json({ error: "txn_retrieval_ref is required" });
    }

    try {
        const statusData = await netsService.queryTransaction(txn_retrieval_ref);
        const txnStatus = Number(statusData.txnStatus);
        const responseCode = statusData.responseCode;

        console.log("Query result - txnStatus:", txnStatus, "responseCode:", responseCode);

        // txn_status == 2 means payment successful
        if (txnStatus === 2) {
            const pending = req.session.netsPending;
            if (!pending || pending.txnRetrievalRef !== txn_retrieval_ref) {
                return res
                    .status(400)
                    .json({ error: "No pending NETS session for this transaction" });
            }

            // If already completed in session, return existing orderId
            if (pending.completed && pending.orderId) {
                return res.json({ status: "paid", orderId: pending.orderId });
            }

            const { orderId, total } = await createOrderFromCart(
                req.session.user.id,
                {
                    paymentMethod: "NETS",
                    paymentStatus: "PAID",
                    paymentRef: txn_retrieval_ref,
                    payerEmail: "NETS",
                    paidAt: new Date(),
                    deliveryType: pending.deliveryType || "NOW",
                    scheduledAt: pending.scheduledAt || null,
                    etaMin: pending.etaMin,
                    etaMax: pending.etaMax,
                    promoCode: pending.promoCode,
                    promoDiscount: pending.promoDiscount,
                    clearCart: true,
                    forceTotal: pending.amount ?? total,
                }
            );

            req.session.netsPending = {
                ...pending,
                completed: true,
                orderId,
            };

            Transaction.create(
                {
                    orderId: String(orderId),
                    payerId: pending.txnId,
                    payerEmail: "NETS",
                    amount: total,
                    currency: "SGD",
                    status: `NETS_${txnStatus}`,
                    time: new Date(),
                    paymentMethod: "NETS",
                    paymentRef: txn_retrieval_ref,
                },
                (txnErr) => txnErr && console.error("Transaction insert error:", txnErr)
            );

            return res.json({ status: "paid", orderId });
        }

        // txn_status == 3 means payment failed or cancelled
        if (txnStatus === 3) {
            return res.json({
                status: "failed",
                message: "NETS payment failed or was cancelled",
                response_code: responseCode,
            });
        }

        // Any other status is pending
        return res.json({
            status: "pending",
            txn_status: txnStatus,
            response_code: responseCode,
        });
    } catch (err) {
        console.error("NETS query error:", err);
        return res
            .status(500)
            .json({ error: err.message || "NETS query failed" });
    }
}

module.exports = {
    requestQr,
    queryStatus,
};
