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
    // ADD ITEM TO CART (FIXED LOGIC)
    // ---------------------------------------------------------
    addItem(userId, productId, requestedQty, callback) {

        // 1. Check if product already exists in cart
        const cartSql = `
            SELECT quantity 
            FROM cart_items 
            WHERE user_id = ? AND product_id = ?
        `;

        db.query(cartSql, [userId, productId], (err, cartRows) => {
            if (err) return callback(err);

            const currentCartQty = cartRows.length ? cartRows[0].quantity : 0;

            // 2. Get remaining stock in DB (already reduced after each add)
            const stockSql = `SELECT quantity FROM products WHERE id = ?`;

            db.query(stockSql, [productId], (err2, stockRows) => {
                if (err2) return callback(err2);

                const dbStock = stockRows[0]?.quantity || 0;

                // 3. User can add ONLY up to what is left in DB stock
                const actualAdd = Math.min(requestedQty, dbStock);

                // No stock left → nothing can be added
                if (actualAdd <= 0) {
                    return callback(null, { added: 0, max: currentCartQty });
                }

                // 4A. Update existing cart item
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
                            callback(null, {
                                added: actualAdd,
                                max: currentCartQty + actualAdd
                            });
                        }
                    );
                }

                // 4B. Insert new cart item
                const insertSql = `
                    INSERT INTO cart_items (user_id, product_id, quantity)
                    VALUES (?, ?, ?)
                `;
                db.query(insertSql, [userId, productId, actualAdd], (err3) => {
                    if (err3) return callback(err3);
                    callback(null, { added: actualAdd, max: actualAdd });
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
    // CLEAR FULL CART (AFTER CHECKOUT)
    // ---------------------------------------------------------
    clearCart(userId, callback) {
        const sql = `
            DELETE FROM cart_items 
            WHERE user_id = ?
        `;
        db.query(sql, [userId], callback);
    },

    // ---------------------------------------------------------
    // GET SINGLE CART ITEM (FOR DELETE/UPDATE)
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
