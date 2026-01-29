// controllers/paypalController.js
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const paypalService = require("../services/paypalService");
const { applyPromo } = require("../services/promoService");

async function getCartTotal(userId) {
    const cart = await new Promise((resolve, reject) => {
        Cart.getCart(userId, (err, rows) => (err ? reject(err) : resolve(rows || [])));
    });

    if (!cart.length) return { cart: [], total: 0 };

    let total = 0;
    cart.forEach((i) => (total += Number(i.price) * Number(i.quantity)));
    return { cart, total };
}

exports.createOrder = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { amount, promoCode, deliveryType, scheduledAt } = req.body;

        // Validate promo if provided
        let promoDiscount = 0;
        if (promoCode) {
            const promoResult = await applyPromo(promoCode, amount);
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

        const finalAmount = Math.max(0, amount - promoDiscount);
        const paypalOrder = await paypalService.createOrder(finalAmount);
        
        // Store in session for later use
        req.session.paypalPending = {
            promoCode,
            promoDiscount,
            deliveryType: deliveryType || 'NOW',
            scheduledAt: scheduledAt || null,
            amount: finalAmount
        };

        return res.json({ id: paypalOrder.id });
    } catch (err) {
        console.error("PayPal createOrder error:", err.message);
        return res.status(500).json({ error: err.message });
    }
};

// IMPORTANT: only create DB order AFTER PayPal capture is completed
exports.captureOrder = async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { orderID } = req.body;

        if (!orderID) return res.status(400).json({ error: "Missing orderID" });

        const capture = await paypalService.captureOrder(orderID);

        // PayPal success check
        if (capture.status !== "COMPLETED") {
            return res.status(400).json({ error: "Payment not completed", capture });
        }

        // Get cart
        const { cart, total } = await getCartTotal(userId);
        if (!cart.length) return res.status(400).json({ error: "Cart is empty" });

        // Get promo data from session
        const pending = req.session.paypalPending || {};
        const promoDiscount = pending.promoDiscount || 0;
        const deliveryType = pending.deliveryType || 'NOW';
        const scheduledAt = pending.scheduledAt || null;
        const promoCode = pending.promoCode || null;

        // Calculate ETA for NOW deliveries
        let etaMin = null, etaMax = null;
        if (deliveryType === 'NOW') {
            etaMin = 45;
            etaMax = 60;
        }

        // Create order with delivery/promo metadata
        const newOrderId = await new Promise((resolve, reject) => {
            Order.create(
                userId,
                total,
                {
                    paymentMethod: 'PAYPAL',
                    paymentStatus: 'PAID',
                    paymentRef: orderID,
                    payerEmail: capture.payer?.email_address || null,
                    paidAt: new Date(),
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
                    newOrderId,
                    item.product_id,
                    item.productName,
                    item.price,
                    item.quantity,
                    (err) => (err ? reject(err) : resolve())
                );
            });
        }

        await new Promise((resolve, reject) => {
            Cart.clearCart(userId, (err) => (err ? reject(err) : resolve()));
        });

        // Cleanup session
        req.session.paypalPending = null;

        // Return orderId so frontend can redirect to success page
        return res.json({
            success: true,
            orderId: newOrderId,
            paypalOrderId: orderID,
        });
    } catch (err) {
        console.error("PayPal captureOrder error:", err.message);
        return res.status(500).json({ error: err.message });
    }
};
