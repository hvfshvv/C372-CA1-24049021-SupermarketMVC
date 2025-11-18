const Product = require('../models/Product');

const CartController = {
    // Add item to cart
    add: (req, res) => {
        const id = req.params.id;
        const quantity = parseInt(req.body.quantity) || 1;

        Product.getById(id, (err, product) => {
            if (!product) return res.status(404).send('Product not found');

            if (!req.session.cart) req.session.cart = [];

            const existing = req.session.cart.find(i => i.id == id);

            if (existing) {
                existing.quantity += quantity;
            } else {
                req.session.cart.push({
                    id: product.id,
                    productName: product.productName,
                    price: product.price,
                    image: product.image,
                    quantity
                });
            }

            res.redirect('/cart');
        });
    },

    // View cart
    view: (req, res) => {
        res.render('cart', { cart: req.session.cart || [] });
    },

    // Remove item from cart
    delete: (req, res) => {
        const id = req.params.id;
        req.session.cart = (req.session.cart || []).filter(item => item.id != id);
        res.redirect('/cart');
    }
};

module.exports = CartController;
