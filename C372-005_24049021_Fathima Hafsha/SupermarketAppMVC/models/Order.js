// models/Order.js
const db = require("../db");

const Order = {

    // Create a new order
    create(userId, totalAmount, opts = {}, cb) {
        // Allow signature (userId, totalAmount, callback)
        if (typeof opts === "function") {
            cb = opts;
            opts = {};
        }
        const {
            paymentMethod = 'UNKNOWN',
            paymentStatus = 'PENDING',
            paymentRef = null,
            payerEmail = null,
            paidAt = null,
            deliveryType = 'NOW',
            scheduledAt = null,
            etaMin = null,
            etaMax = null,
            promoCode = null,
            promoDiscount = 0
        } = opts;
        const sql = `
    INSERT INTO orders (user_id, total_amount, payment_method, payment_status, payment_ref, payer_email, paid_at, delivery_type, scheduledAt, eta_min, eta_max, promoCode, promoDiscount, delivery_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PREPARING')
  `;
        db.query(sql, [userId, totalAmount, paymentMethod, paymentStatus, paymentRef, payerEmail, paidAt, deliveryType, scheduledAt, etaMin, etaMax, promoCode, promoDiscount], (err, r) => {
            if (err) {
                console.error("Order.create SQL error:", err.sqlMessage || err.message, "SQL:", err.sql);
                return cb(err);
            }
            cb(null, r.insertId);
        });
    },

    // Add an item into order_items
    addItem(orderId, productId, name, price, qty, callback) {
        const sql = `
            INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
            VALUES (?, ?, ?, ?, ?)
        `;
        db.query(sql, [orderId, productId, name, price, qty], (err, r) => {
            if (err) {
                console.error("Order.addItem SQL error:", err.sqlMessage || err.message, "SQL:", err.sql);
            }
            callback(err, r);
        });
    },

    // Get one order by ID
    getById(orderId, callback) {
        db.query(
            `SELECT * FROM orders WHERE id = ?`,
            [orderId],
            (err, results) => {
                if (err) return callback(err);
                callback(null, results[0] || null);
            }
        );
    },

    // Get all orders for a specific user
    getByUser(userId, callback) {
        const sql = `
            SELECT * 
            FROM orders 
            WHERE user_id = ? 
            ORDER BY order_date DESC
        `;

        db.query(sql, [userId], (err, results) => {
            if (err) return callback(err);
            callback(null, results);
        });
    },

    // Get all items inside one order
    getItems(orderId, callback) {
        db.query(
            `SELECT * FROM order_items WHERE order_id = ?`,
            [orderId],
            (err, results) => {
                if (err) return callback(err);
                callback(null, results);
            }
        );
    },

    // Get order + items together
    getOrderWithItems(orderId, callback) {
        const orderSql = `SELECT * FROM orders WHERE id = ?`;
        const itemsSql = `SELECT * FROM order_items WHERE order_id = ?`;

        db.query(orderSql, [orderId], (err, orderRows) => {
            if (err) return callback(err);

            const order = orderRows[0];
            if (!order) return callback(null, null, []);

            db.query(itemsSql, [orderId], (err, itemRows) => {
                if (err) return callback(err);
                callback(null, order, itemRows);
            });
        });
    },

    // ADMIN: view every order from all users
    getAllOrders(callback) {
        const sql = `
            SELECT 
                orders.id AS order_id,
                orders.total_amount,
                orders.order_date,
                orders.payment_status,
                orders.payment_method,
                orders.delivery_status,
                orders.delivery_type,
                orders.scheduledAt,
                orders.eta_min,
                orders.eta_max,
                orders.refundStatus,
                orders.refundReason,
                orders.refundRequestedAt,
                orders.refundReviewedAt,
                users.username AS customer_name,
                users.email
            FROM orders
            JOIN users ON users.id = orders.user_id
            ORDER BY orders.order_date DESC
        `;
        db.query(sql, callback);
    },

    // Get tracking info for an order
    getTracking(orderId, callback) {
        const sql = `
            SELECT 
                id, delivery_status, deliveryUpdatedAt, eta_min, eta_max, delivery_type, scheduledAt
            FROM orders 
            WHERE id = ?
        `;
        db.query(sql, [orderId], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0] || null);
        });
    },

    // Update delivery status (admin)
    updateDeliveryStatus(orderId, status, callback) {
        const sql = `
            UPDATE orders 
            SET delivery_status = ?, deliveryUpdatedAt = NOW()
            WHERE id = ?
        `;
        db.query(sql, [status, orderId], callback);
    }
};

// Export
module.exports = Order;
