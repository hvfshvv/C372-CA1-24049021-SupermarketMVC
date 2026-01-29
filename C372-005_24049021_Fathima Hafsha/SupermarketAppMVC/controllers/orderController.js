// controllers/orderController.js
let Order = require('../models/Order');
const db = require("../db");

function fetchUserOrders(userId, callback) {
    db.query(
        `SELECT * FROM orders WHERE user_id = ? ORDER BY order_date DESC`,
        [userId],
        (err, rows) => callback(err, rows || [])
    );
}

const OrderController = {

    // Auto-expire payments stuck in PENDING or PROCESSING >5 minutes
    expirePendingPayments(callback) {
        db.query(
            `UPDATE orders
             SET payment_status='CANCELLED'
             WHERE (payment_status='PENDING' OR payment_status='PROCESSING')
               AND order_date < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
            () => callback()
        );
    },

    // My Orders page for normal users
    list: (req, res) => {
        // ensure fresh model (avoids rare require cache issues)
        Order = require('../models/Order');
        const user = req.session.user;
        if (user && user.role === "admin") {
            return res.redirect("/admin/orders");
        }

        OrderController.expirePendingPayments(() => {
            fetchUserOrders(user.id, async (err, orders) => {
                if (err) {
                    console.error("USER ORDERS ERROR:", err);
                    return res.status(500).send("Failed to load orders");
                }
                // Attach latest transaction (to show refund requests/status)
                const withTxn = await Promise.all(
                    (orders || []).map(async (o) => {
                        const txn = await new Promise((resolve) =>
                            require("../models/Transaction").getLatestByOrder(o.id, (e, row) =>
                                resolve(row || null)
                            )
                        );
                        return { ...o, latestTxn: txn };
                    })
                );
                res.render("orders", { orders: withTxn, user });
            });
        });
    },

    // Refund center (user)
    refundsPage: (req, res) => {
        const user = req.session.user;
        fetchUserOrders(user.id, async (err, orders) => {
            if (err) {
                console.error("USER REFUNDS ERROR:", err);
                return res.status(500).send("Failed to load orders");
            }
            const Transaction = require("../models/Transaction");
            const now = Date.now();
            const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
            const eligible = (orders || []).filter(o => {
                const payOk = ["PAID", "PARTIAL_REFUND", "REFUNDED"].includes((o.payment_status || "").toUpperCase());
                const methodOk = ["STRIPE", "PAYPAL"].includes(o.payment_method || "");
                const orderTs = o.order_date ? new Date(o.order_date).getTime() : 0;
                const withinWindow = orderTs > 0 && (now - orderTs) <= sevenDaysMs;
                return payOk && methodOk && withinWindow;
            });
            const withTxn = await Promise.all(
                eligible.map(async (o) => {
                    const txn = await new Promise((resolve) =>
                        Transaction.getLatestByOrder(o.id, (e, row) => resolve(row || null))
                    );
                    return { ...o, latestTxn: txn };
                })
            );
            res.render("refunds", { orders: withTxn, user });
        });
    },

    // Order detail for user
    detail: (req, res) => {
        const user = req.session.user;
        const orderId = req.params.id;
        OrderController.expirePendingPayments(() => Order.getOrderWithItems(orderId, (err, order, items) => {
            if (err || !order) {
                req.flash("error", "Order not found");
                return res.redirect("/orders");
            }
            if (order.user_id !== user.id && user.role !== "admin") {
                req.flash("error", "Access denied");
                return res.redirect("/orders");
            }
            const Transaction = require("../models/Transaction");
            Transaction.getLatestByOrder(orderId, (e2, txn) => {
                const latestTxn = txn || null;
                res.render("orderDetail", { order, items, latestTxn, user });
            });
        }));
    },

    // User payment history
    transactions: (req, res) => {
        const user = req.session.user;
        const Transaction = require("../models/Transaction");
        db.query(
            `SELECT * FROM transactions WHERE orderId IN (SELECT id FROM orders WHERE user_id=?) ORDER BY time DESC`,
            [user.id],
            (err, rows) => {
                if (err) {
                    console.error("USER TXN ERROR:", err);
                    req.flash("error", "Failed to load payment history");
                    return res.redirect("/orders");
                }
                res.render("paymentHistory", { transactions: rows || [], user });
            }
        );
    },

    // ADMIN: View all orders from all users
    adminList: async (req, res) => {
        OrderController.expirePendingPayments(() => Order.getAllOrders(async (err, results) => {
            if (err) {
                console.error("ADMIN ORDERS ERROR:", err);
                return res.status(500).send("Failed to load all orders");
            }

            const Transaction = require("../models/Transaction");
            let list = results || [];

            // optional filters
            const methodFilter = req.query.method;
            const statusFilter = req.query.status;
            const refundFilter = req.query.refund;
            const query = (req.query.q || "").toLowerCase();
            const deliveryFilter = req.query.delivery;

            if (methodFilter) {
                list = list.filter(o => (o.payment_method || "").toUpperCase() === methodFilter.toUpperCase());
            }
            if (statusFilter) {
                list = list.filter(o => (o.payment_status || "").toUpperCase() === statusFilter.toUpperCase());
            }
            if (refundFilter) {
                list = list.filter(o => (o.refundStatus || "NONE").toUpperCase() === refundFilter.toUpperCase());
            }
            if (deliveryFilter) {
                list = list.filter(o => (o.delivery_status || "PREPARING").toUpperCase() === deliveryFilter.toUpperCase());
            }
            if (query) {
                list = list.filter(o =>
                    (o.customer_name || "").toLowerCase().includes(query) ||
                    (o.email || "").toLowerCase().includes(query) ||
                    String(o.order_id || "").includes(query)
                );
            }

            const withTxn = await Promise.all(
                list.map(async (o) => {
                    const txn = await new Promise((resolve) =>
                        Transaction.getLatestByOrder(o.order_id, (e, row) => resolve(row || null))
                    );
                    return { ...o, latestTxn: txn };
                })
            );

            res.render("adminOrders", {
                orders: withTxn,
                user: req.session.user,
                q: req.query.q || "",
                status: req.query.status || "",
                refund: req.query.refund || "",
                method: req.query.method || "",
                delivery: req.query.delivery || ""
            });
        }));
    },

    // ADMIN: Delivery + Refund queue
    adminFulfill: async (req, res) => {
        OrderController.expirePendingPayments(() => Order.getAllOrders(async (err, results) => {
            if (err) {
                console.error("ADMIN FULFILL ERROR:", err);
                return res.status(500).send("Failed to load orders");
            }
            const Transaction = require("../models/Transaction");
            let list = results || [];

            // default: only undelivered or refund requested
            list = list.filter(o =>
                (o.delivery_status || "PREPARING") !== "DELIVERED" ||
                ((o.refundStatus || "NONE").toUpperCase() === "REQUESTED")
            );

            const withTxn = await Promise.all(
                list.map(async (o) => {
                    const txn = await new Promise((resolve) =>
                        Transaction.getLatestByOrder(o.order_id, (e, row) => resolve(row || null))
                    );
                    return { ...o, latestTxn: txn };
                })
            );

            res.render("adminFulfillment", {
                orders: withTxn,
                user: req.session.user
            });
        }));
    },

    // Stats for profile page (already used in your profile controller)
    getStats: (userId, callback) => {
        fetchUserOrders(userId, (err, orders) => {
            if (err) return callback(err, null);

            const totalOrders = orders.length;
            let totalSpent = 0;

            orders.forEach(o => {
                totalSpent += Number(o.total_amount || 0);
            });

            callback(null, { totalOrders, totalSpent });
        });
    }
};

module.exports = OrderController;
