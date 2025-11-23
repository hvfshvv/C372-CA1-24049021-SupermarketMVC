const Product = require('../models/Product');

const ProductController = {

    list: function (req, res) {
        const search = req.query.search || null;
        const category = req.query.category || null;
        const user = req.session?.user || null;

        // Case 1 – Search + Category
        if (search && category) {
            return Product.searchAndFilter(search, category, (err, products) => {
                if (err) return res.status(500).send("Internal Server Error");

                products.forEach(p => {
                    p.quantity = Number(p.quantity) || 0;
                    p.lowStock = p.quantity < 30;
                });

                return res.render("shopping", {
                    products,
                    user,
                    search,
                    category
                });
            });
        }

        // Case 2 – Category Only
        if (category) {
            return Product.filterByCategory(category, (err, products) => {
                if (err) return res.status(500).send("Internal Server Error");

                products.forEach(p => {
                    p.quantity = Number(p.quantity) || 0;
                    p.lowStock = p.quantity < 30;
                });

                return res.render("shopping", {
                    products,
                    user,
                    search: "",
                    category
                });
            });
        }

        // Case 3 – Search Only
        if (search) {
            return Product.search(search, (err, products) => {
                if (err) return res.status(500).send("Internal Server Error");

                products.forEach(p => {
                    p.quantity = Number(p.quantity) || 0;
                    p.lowStock = p.quantity < 30;
                });

                return res.render("shopping", {
                    products,
                    user,
                    search,
                    category: ""
                });
            });
        }

        // Case 4 – Default
        Product.getAll((err, products) => {
            if (err) return res.status(500).send("Internal Server Error");

            products.forEach(p => {
                p.quantity = Number(p.quantity) || 0;
                p.lowStock = p.quantity < 30;
            });

            if (user && user.role === 'admin') {
                return res.render("inventory", { products, user });
            }

            return res.render("shopping", {
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
