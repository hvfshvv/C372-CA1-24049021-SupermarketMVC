// models/Order.js
const db = require("../db");

const Order = {

    // Create a new order
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

    // Add an item into order_items
    addItem(orderId, productId, name, price, qty, callback) {
        const sql = `
            INSERT INTO order_items (order_id, product_id, product_name, price, quantity)
            VALUES (?, ?, ?, ?, ?)
        `;
        db.query(sql, [orderId, productId, name, price, qty], callback);
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
                users.username AS customer_name,
                users.email
            FROM orders
            JOIN users ON users.id = orders.user_id
            ORDER BY orders.order_date DESC
        `;
        db.query(sql, callback);
    }
};

module.exports = Order;
