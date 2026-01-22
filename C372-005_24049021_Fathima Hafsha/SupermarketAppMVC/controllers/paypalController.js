// controllers/paypalController.js
const Cart = require("../models/Cart");
const Order = require("../models/Order");
const paypalService = require("../services/paypalService");

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
        const { total } = await getCartTotal(userId);

        if (total <= 0) return res.status(400).json({ error: "Cart is empty" });

        const paypalOrder = await paypalService.createOrder(total);
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
        const { orderId } = req.body;

        if (!orderId) return res.status(400).json({ error: "Missing orderId" });

        const capture = await paypalService.captureOrder(orderId);

        // PayPal success check (worksheet usually checks COMPLETED)
        if (capture.status !== "COMPLETED") {
            return res.status(400).json({ error: "Payment not completed", capture });
        }

        // Now create DB order (your CA1 logic)
        const { cart, total } = await getCartTotal(userId);
        if (!cart.length) return res.status(400).json({ error: "Cart is empty" });

        const newOrderId = await new Promise((resolve, reject) => {
            Order.create(userId, total, (err, id) => (err ? reject(err) : resolve(id)));
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

        // Return orderId so frontend can redirect to success page
        return res.json({
            success: true,
            orderId: newOrderId,
            paypalOrderId: capture.id,
        });
    } catch (err) {
        console.error("PayPal captureOrder error:", err.message);
        return res.status(500).json({ error: err.message });
    }
};
