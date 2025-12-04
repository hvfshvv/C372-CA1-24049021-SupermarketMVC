// models/Cart.js
const db = require("../db");

const Cart = {

    // ---------------------------------------------------------
    // GET ALL ITEMS IN CART FOR USER
    // ---------------------------------------------------------
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

    // ---------------------------------------------------------
    // ADD ITEM (FULL LOGIC WITH currentCartQty + liveStock)
    // ---------------------------------------------------------
    addItem(userId, productId, requestedQty, callback) {

        // 1) Check if item already in cart
        const checkSql = `
            SELECT quantity 
            FROM cart_items 
            WHERE user_id = ? AND product_id = ?
        `;

        db.query(checkSql, [userId, productId], (err, cartRows) => {
            if (err) return callback(err);

            const currentCartQty = cartRows.length > 0 ? cartRows[0].quantity : 0;

            // 2) Get live stock from DB
            const stockSql = `SELECT quantity FROM products WHERE id = ?`;

            db.query(stockSql, [productId], (err2, stockRows) => {
                if (err2) return callback(err2);

                const dbStock = stockRows[0]?.quantity || 0;

                // 3) Total the customer is allowed to have
                const maxPossible = currentCartQty + dbStock;

                // Clamp requested addition
                let actualAdd = requestedQty;

                if (currentCartQty + requestedQty > maxPossible) {
                    actualAdd = maxPossible - currentCartQty;  // clamp
                }

                // Nothing can be added (no stock)
                if (actualAdd <= 0) {
                    return callback(null, { added: 0, max: maxPossible });
                }

                // ---------------------------------------------------------
                // 4A) IF ITEM EXISTS → UPDATE quantity
                // ---------------------------------------------------------
                if (cartRows.length > 0) {
                    const updateSql = `
                        UPDATE cart_items
                        SET quantity = quantity + ?
                        WHERE user_id = ? AND product_id = ?
                    `;

                    return db.query(
                        updateSql,
                        [actualAdd, userId, productId],
                        (err3) => {
                            if (err3) return callback(err3);
                            callback(null, { added: actualAdd, max: maxPossible });
                        }
                    );
                }

                // ---------------------------------------------------------
                // 4B) IF NOT EXISTS → INSERT new row
                // ---------------------------------------------------------
                const insertSql = `
                    INSERT INTO cart_items (user_id, product_id, quantity)
                    VALUES (?, ?, ?)
                `;

                db.query(insertSql, [userId, productId, actualAdd], (err3) => {
                    if (err3) return callback(err3);
                    callback(null, { added: actualAdd, max: maxPossible });
                });
            });
        });
    },

    // ---------------------------------------------------------
    // UPDATE CART QUANTITY
    // ---------------------------------------------------------
    updateQuantity(cartId, newQty, callback) {
        const sql = `
            UPDATE cart_items 
            SET quantity = ?
            WHERE id = ?
        `;
        db.query(sql, [newQty, cartId], callback);
    },

    // ---------------------------------------------------------
    // DELETE ITEM FROM CART
    // ---------------------------------------------------------
    deleteItem(cartId, callback) {
        const sql = `
            DELETE FROM cart_items 
            WHERE id = ?
        `;
        db.query(sql, [cartId], callback);
    },

    // ---------------------------------------------------------
    // CLEAR FULL CART (AFTER ORDER)
    // ---------------------------------------------------------
    clearCart(userId, callback) {
        const sql = `
            DELETE FROM cart_items 
            WHERE user_id = ?
        `;
        db.query(sql, [userId], callback);
    },

    // ---------------------------------------------------------
    // GET ONE CART ITEM (for update/delete)
    // ---------------------------------------------------------
    getItemById(cartId, callback) {
        const sql = `
            SELECT * 
            FROM cart_items 
            WHERE id = ?
        `;
        db.query(sql, [cartId], (err, rows) => {
            if (err) return callback(err);
            callback(null, rows[0] || null);
        });
    }
};

module.exports = Cart;
