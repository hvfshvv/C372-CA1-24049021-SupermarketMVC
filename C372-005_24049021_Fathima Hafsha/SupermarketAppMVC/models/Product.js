const db = require('../db');

const Product = {
    getAll: (callback) => {
        db.query('SELECT * FROM products', callback);
    },

    getById: (id, callback) => {
        db.query('SELECT * FROM products WHERE id = ?', [id], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0] || null);
        });
    },

    add: (product, callback) => {
        const sql =
            'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
        db.query(sql, [product.productName, product.quantity, product.price, product.image], callback);
    },

    update: (id, product, callback) => {
        const sql =
            'UPDATE products SET productName=?, quantity=?, price=?, image=? WHERE id=?';
        db.query(sql, [product.productName, product.quantity, product.price, product.image, id], callback);
    },

    delete: (id, callback) => {
        db.query('DELETE FROM products WHERE id=?', [id], callback);
    }
};

module.exports = Product;
