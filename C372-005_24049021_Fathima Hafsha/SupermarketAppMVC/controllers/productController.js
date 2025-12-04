// controllers/productController.js
const Product = require('../models/Product');

const LOW_STOCK_LIMIT = 10;

const ProductController = {

    list: function (req, res) {
        const search = req.query.search || null;
        const category = req.query.category || null;
        const user = req.session?.user || null;

        const applyStockFlags = (products) => {
            products.forEach(p => {
                p.quantity = Number(p.quantity) || 0;
                p.lowStock = p.quantity < LOW_STOCK_LIMIT;
            });
        };

        // CASE 1 — Search + Filter
        if (search && category) {
            return Product.searchAndFilter(search, category, (err, products) => {
                if (err) return res.status(500).send("Internal Server Error");
                applyStockFlags(products);

                return res.render("shop", {
                    products,
                    user,
                    search,
                    category
                });
            });
        }

        // CASE 2 — Category only
        if (category) {
            return Product.filterByCategory(category, (err, products) => {
                if (err) return res.status(500).send("Internal Server Error");
                applyStockFlags(products);

                return res.render("shop", {
                    products,
                    user,
                    search: "",
                    category
                });
            });
        }

        // CASE 3 — Search only
        if (search) {
            return Product.search(search, (err, products) => {
                if (err) return res.status(500).send("Internal Server Error");
                applyStockFlags(products);

                return res.render("shop", {
                    products,
                    user,
                    search,
                    category: ""
                });
            });
        }

        // CASE 4 — Default listing
        Product.getAll((err, products) => {
            if (err) return res.status(500).send("Internal Server Error");

            applyStockFlags(products);

            if (user && user.role === 'admin') {
                return res.render("inventory", { products, user });
            }

            return res.render("shop", {
                products,
                user,
                search: "",
                category: ""
            });
        });
    },

    getById: function (req, res) {
        const id = req.params.id;

        Product.getById(id, (err, product) => {
            if (err) return res.status(500).send("Internal Server Error");
            if (!product) return res.status(404).send("Product not found");

            product.lowStock = product.quantity < LOW_STOCK_LIMIT;

            res.render("product", {
                product,
                user: req.session.user || null
            });
        });
    },

    add: function (req, res) {
        const product = {
            productName: req.body.productName,
            quantity: parseInt(req.body.quantity),
            price: parseFloat(req.body.price),
            image: req.file ? req.file.filename : null,
            category: req.body.category || "Other"
        };

        Product.add(product, err => {
            if (err) return res.status(500).send("Failed to add product");
            res.redirect('/inventory');
        });
    },

    update: function (req, res) {
        const id = req.params.id;

        const product = {
            productName: req.body.productName,
            quantity: parseInt(req.body.quantity),
            price: parseFloat(req.body.price),
            image: req.file ? req.file.filename : req.body.currentImage,
            category: req.body.category || "Other"
        };

        Product.update(id, product, (err, result) => {
            if (err) return res.status(500).send("Failed to update product");
            if (result.affectedRows === 0) return res.status(404).send("Product not found");
            res.redirect('/inventory');
        });
    },

    delete: function (req, res) {
        const id = req.params.id;

        Product.delete(id, (err, result) => {
            if (err) return res.status(500).send("Failed to delete product");
            if (result.affectedRows === 0) return res.status(404).send("Product not found");
            res.redirect('/inventory');
        });
    }
};

module.exports = ProductController;
