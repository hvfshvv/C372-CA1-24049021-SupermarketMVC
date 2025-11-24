const db = require("../db");

const Order = {
    create(userId, totalAmount, callback) {
        const sql = `
            INSERT INTO orders (user_id, total_amount)
            VALUES (?, ?)
        `;
        db.query(sql, [userId, totalAmount], (err, result) => {
            if (err) return callback(err);
            callback(null, result.insertId);
        });
    },

    addItem(orderId, productId, name, price, qty, callback) {
        const sql = `
            INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
            VALUES (?, ?, ?, ?, ?)
        `;
        db.query(sql, [orderId, productId, name, price, qty], callback);
    },

    getById(orderId, callback) {
        db.query(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0] || null);
        });
    },

    getByUser(userId, callback) {
        db.query(
            `SELECT * FROM orders WHERE user_id = ? ORDER BY order_date DESC`,
            [userId],
            callback
        );
    },

    getItems(orderId, callback) {
        db.query(
            `SELECT * FROM order_items WHERE order_id = ?`,
            [orderId],
            callback
        );
    }
};

module.exports = Order;
