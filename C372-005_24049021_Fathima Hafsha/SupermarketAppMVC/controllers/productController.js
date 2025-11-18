const Product = require('../models/Product');

const ProductController = {
    // List products (admin → inventory, user → shopping)
    list: (req, res) => {
        Product.getAll((err, products) => {
            if (err) return res.status(500).send('Error loading products');

            const user = req.session.user || null;

            // Mark low stock
            products.forEach(p => {
                p.lowStock = p.quantity < 30;
            });

            if (user?.role === 'admin') {
                return res.render('inventory', { products, user });
            }

            res.render('shopping', { products, user });
        });
    },

    // View one product
    getById: (req, res) => {
        Product.getById(req.params.id, (err, product) => {
            if (!product) return res.status(404).send('Product not found');
            res.render('product', { product, user: req.session.user });
        });
    },

    // Add a product
    add: (req, res) => {
        const product = {
            productName: req.body.productName,
            quantity: req.body.quantity,
            price: req.body.price,
            image: req.file?.filename || null
        };

        Product.add(product, (err) => {
            if (err) return res.status(500).send('Failed to add product');
            res.redirect('/inventory');
        });
    },

    // Update a product
    update: (req, res) => {
        const product = {
            productName: req.body.productName,
            quantity: req.body.quantity,
            price: req.body.price,
            image: req.file?.filename || req.body.currentImage
        };

        Product.update(req.params.id, product, (err) => {
            if (err) return res.status(500).send('Failed to update');
            res.redirect('/inventory');
        });
    },

    // Delete a product
    delete: (req, res) => {
        Product.delete(req.params.id, (err) => {
            if (err) return res.status(500).send('Failed to delete');
            res.redirect('/inventory');
        });
    }
};

module.exports = ProductController;
