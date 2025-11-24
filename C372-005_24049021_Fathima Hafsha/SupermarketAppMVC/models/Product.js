const db = require('../db');

const Product = {

    getAll(callback) {
        const sql = `
            SELECT id, productName, quantity, price, image, category
            FROM products
        `;
        db.query(sql, callback);
    },

    getById(id, callback) {
        const sql = `
            SELECT id, productName, quantity, price, image, category
            FROM products
            WHERE id = ?
        `;
        db.query(sql, [id], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0] || null);
        });
    },

    add(product, callback) {
        const sql = `
            INSERT INTO products (productName, quantity, price, image, category)
            VALUES (?, ?, ?, ?, ?)
        `;
        const params = [
            product.productName,
            product.quantity,
            product.price,
            product.image,
            product.category
        ];
        db.query(sql, params, callback);
    },

    update(id, product, callback) {
        const sql = `
            UPDATE products SET 
            productName=?, quantity=?, price=?, image=?, category=?
            WHERE id=?
        `;
        const params = [
            product.productName,
            product.quantity,
            product.price,
            product.image,
            product.category,
            id
        ];
        db.query(sql, params, callback);
    },

    delete(id, callback) {
        db.query(`DELETE FROM products WHERE id=?`, [id], callback);
    },

    search(keyword, callback) {
        db.query(
            `SELECT * FROM products WHERE productName LIKE ?`,
            [`%${keyword}%`],
            callback
        );
    },

    filterByCategory(category, callback) {
        db.query(
            `SELECT * FROM products WHERE category = ?`,
            [category],
            callback
        );
    },

    searchAndFilter(keyword, category, callback) {
        db.query(
            `SELECT * FROM products WHERE productName LIKE ? AND category = ?`,
            [`%${keyword}%`, category],
            callback
        );
    },

    checkStock(id, qty, callback) {
        db.query(
            `SELECT quantity FROM products WHERE id = ?`,
            [id],
            (err, results) => {
                if (err) return callback(err);
                if (!results.length) return callback(null, false);

                callback(null, results[0].quantity >= qty);
            }
        );
    },

    reduceStock(id, qty, callback) {
        const sql = `
            UPDATE products 
            SET quantity = quantity - ?
            WHERE id = ? AND quantity >= ?
        `;

        db.query(sql, [qty, id, qty], callback);
    }
};

module.exports = Product;
