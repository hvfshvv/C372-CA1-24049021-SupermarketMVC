const db = require("../db");

const Order = {

    // Create an order
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

    // Add item to order
    addItem(orderId, productId, name, price, qty, callback) {
        const sql = `
            INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
            VALUES (?, ?, ?, ?, ?)
        `;
        db.query(sql, [orderId, productId, name, price, qty], callback);
    },

    // Get a single order
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

    // Get all orders by user
    getByUser(userId, callback) {
        db.query(
            `SELECT * FROM orders WHERE user_id = ? ORDER BY order_date DESC`,
            [userId],
            (err, results) => {
                if (err) return callback(err, null);
                return callback(null, results);
            }
        );
    },


    // Get items from an order
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

    // Get order + items
    getOrderWithItems(orderId, callback) {
        const orderSql = `SELECT * FROM orders WHERE id = ?`;
        const itemsSql = `SELECT * FROM order_items WHERE order_id = ?`;

        db.query(orderSql, [orderId], (err, orderResults) => {
            if (err) return callback(err);

            const order = orderResults[0];
            if (!order) return callback(null, null, []);

            db.query(itemsSql, [orderId], (err, itemResults) => {
                if (err) return callback(err);
                callback(null, order, itemResults);
            });
        });
    }
};

module.exports = Order;
