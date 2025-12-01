const db = require("../db");

const Cart = {

    getCart(userId, callback) {
        const sql = `
            SELECT c.id AS cart_id, c.quantity, 
                    p.id AS product_id, p.productName, p.price, p.image 
            FROM cart_items c
            JOIN products p ON p.id = c.product_id
            WHERE c.user_id = ?
        `;
        db.query(sql, [userId], callback);
    },

    addItem(userId, productId, quantity, callback) {
        const checkSql = `
            SELECT * FROM cart_items 
            WHERE user_id = ? AND product_id = ?
        `;

        db.query(checkSql, [userId, productId], (err, results) => {
            if (err) return callback(err);

            // If exists → update quantity
            if (results.length > 0) {
                const updateSql = `
                    UPDATE cart_items 
                    SET quantity = quantity + ?
                    WHERE user_id = ? AND product_id = ?
                `;
                return db.query(updateSql, [quantity, userId, productId], callback);
            }

            // Else → insert new
            const insertSql = `
                INSERT INTO cart_items (user_id, product_id, quantity)
                VALUES (?, ?, ?)
            `;
            db.query(insertSql, [userId, productId, quantity], callback);
        });
    },

    updateQuantity(cartId, newQty, callback) {
        const sql = `
            UPDATE cart_items SET quantity = ?
            WHERE id = ?
        `;
        db.query(sql, [newQty, cartId], callback);
    },

    deleteItem(cartId, callback) {
        const sql = `
            DELETE FROM cart_items WHERE id = ?
        `;
        db.query(sql, [cartId], callback);
    },

    clearCart(userId, callback) {
        const sql = `
            DELETE FROM cart_items WHERE user_id = ?
        `;
        db.query(sql, [userId], callback);
    }
};

module.exports = Cart;
