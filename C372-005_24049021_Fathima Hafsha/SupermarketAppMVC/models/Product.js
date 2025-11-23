const db = require('../db');

const Product = {

    // ---------------------------------------------------------
    // GET ALL PRODUCTS
    // ---------------------------------------------------------
    getAll: function (callback) {
        const sql = `
            SELECT id, productName, quantity, price, image, category
            FROM products`;
        db.query(sql, function (err, results) {
            if (err) return callback(err);
            callback(null, results);
        });
    },

    // ---------------------------------------------------------
    // GET PRODUCT BY ID
    // ---------------------------------------------------------
    getById: function (productId, callback) {
        const sql = `
            SELECT id, productName, quantity, price, image, category 
            FROM products 
            WHERE id = ?`;
        db.query(sql, [productId], function (err, results) {
            if (err) return callback(err);
            callback(null, results.length ? results[0] : null);
        });
    },

    // ---------------------------------------------------------
    // ADD PRODUCT
    // ---------------------------------------------------------
    add: function (product, callback) {
        const sql = `
            INSERT INTO products 
            (productName, quantity, price, image, category)
            VALUES (?, ?, ?, ?, ?)`;

        const params = [
            product.productName,
            product.quantity,
            product.price,
            product.image,
            product.category
        ];

        db.query(sql, params, function (err, result) {
            if (err) return callback(err);
            callback(null, { insertId: result.insertId });
        });
    },

    // ---------------------------------------------------------
    // UPDATE PRODUCT
    // ---------------------------------------------------------
    update: function (productId, product, callback) {
        const sql = `
            UPDATE products 
            SET productName = ?, quantity = ?, price = ?, image = ?, category = ?
            WHERE id = ?`;

        const params = [
            product.productName,
            product.quantity,
            product.price,
            product.image,
            product.category,
            productId
        ];

        db.query(sql, params, function (err, result) {
            if (err) return callback(err);
            callback(null, { affectedRows: result.affectedRows });
        });
    },

    // ---------------------------------------------------------
    // DELETE PRODUCT
    // ---------------------------------------------------------
    delete: function (productId, callback) {
        const sql = `DELETE FROM products WHERE id = ?`;
        db.query(sql, [productId], function (err, result) {
            if (err) return callback(err);
            callback(null, { affectedRows: result.affectedRows });
        });
    },

    // ---------------------------------------------------------
    // SEARCH BY NAME
    // ---------------------------------------------------------
    search: function (keyword, callback) {
        const sql = `
            SELECT id, productName, quantity, price, image, category
            FROM products
            WHERE productName LIKE ?`;

        db.query(sql, [`%${keyword}%`], function (err, results) {
            if (err) return callback(err);
            callback(null, results);
        });
    },

    // ---------------------------------------------------------
    // GET ALL UNIQUE CATEGORIES
    // ---------------------------------------------------------
    getCategories: function (callback) {
        const sql = `
            SELECT DISTINCT category 
            FROM products 
            ORDER BY category ASC`;

        db.query(sql, function (err, results) {
            if (err) return callback(err);
            callback(null, results);
        });
    },

    // ---------------------------------------------------------
    // FILTER BY CATEGORY
    // ---------------------------------------------------------
    filterByCategory: function (category, callback) {
        const sql = `
            SELECT id, productName, quantity, price, image, category
            FROM products
            WHERE category = ?`;

        db.query(sql, [category], function (err, results) {
            if (err) return callback(err);
            callback(null, results);
        });
    },

    // ---------------------------------------------------------
    // SEARCH + CATEGORY FILTER COMBINED (OPTIONAL)
    // ---------------------------------------------------------
    searchAndFilter: function (keyword, category, callback) {
        const sql = `
            SELECT id, productName, quantity, price, image, category
            FROM products
            WHERE productName LIKE ?
            AND category = ?`;

        db.query(sql, [`%${keyword}%`, category], function (err, results) {
            if (err) return callback(err);
            callback(null, results);
        });
    }

};

module.exports = Product;
