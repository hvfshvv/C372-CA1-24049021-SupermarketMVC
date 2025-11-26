const Product = require('../models/Product');
const Order = require('../models/Order');

const CartController = {

    add: (req, res) => {
        const id = req.params.id;
        const qty = parseInt(req.body.quantity) || 1;

        Product.getById(id, (err, product) => {
            if (err || !product) return res.status(404).send("Product not found");

            if (qty > product.quantity) {
                req.flash("error", `Only ${product.quantity} left in stock`);
                return res.redirect("/product/" + id);
            }

            if (!req.session.cart) req.session.cart = [];
            const existing = req.session.cart.find(i => i.id == id);

            if (existing) {
                if (existing.quantity + qty > product.quantity) {
                    req.flash("error", `Only ${product.quantity} available`);
                    return res.redirect("/product/" + id);
                }
                existing.quantity += qty;
            } else {
                req.session.cart.push({
                    id: product.id,
                    productName: product.productName,
                    price: product.price,
                    quantity: qty,
                    image: product.image
                });
            }

            res.redirect("/cart");
        });
    },

    view: (req, res) => {
        res.render("cart", { cart: req.session.cart || [] });
    },

    delete: (req, res) => {
        const id = req.params.id;
        req.session.cart = (req.session.cart || []).filter(item => item.id != id);
        res.redirect("/cart");
    },
updateQuantity: (req, res) => {
    const id = req.params.id;
    let qty = parseInt(req.body.quantity);

    if (!qty || qty < 1) qty = 1;

    Product.getById(id, (err, product) => {
        if (err || !product) {
            req.flash("error", "Product not found");
            return res.redirect("/cart");
        }

        if (!req.session.cart) req.session.cart = [];
        const item = req.session.cart.find(i => i.id == id);

        if (!item) {
            req.flash("error", "Item no longer in cart");
            return res.redirect("/cart");
        }

        if (qty > product.quantity) {
            req.flash("error", `Only ${product.quantity} left in stock`);
            return res.redirect("/cart");
        }

        item.quantity = qty;
        req.flash("success", "Cart updated!");
        res.redirect("/cart");
    });
},

    checkoutPage: (req, res) => {
        const cart = req.session.cart || [];

        if (!cart.length) {
            req.flash("error", "Your cart is empty");
            return res.redirect("/shop");
        }

        let total = 0;
        cart.forEach(i => total += i.price * i.quantity);

        res.render("checkout", { cart, total });
    },

    confirmOrder: async (req, res) => {
        const cart = req.session.cart || [];
        const user = req.session.user;

        if (!cart.length) {
            req.flash("error", "Your cart is empty");
            return res.redirect("/cart");
        }

        try {
            for (let item of cart) {
                const enough = await new Promise(resolve => {
                    Product.checkStock(item.id, item.quantity, (err, ok) => resolve(ok));
                });

                if (!enough) {
                    req.flash("error", `Not enough stock for ${item.productName}`);
                    return res.redirect("/cart");
                }
            }

            let total = 0;
            cart.forEach(i => total += i.price * i.quantity);

            const orderId = await new Promise((resolve, reject) => {
                Order.create(user.id, total, (err, id) => {
                    if (err) return reject(err);
                    resolve(id);
                });
            });

            for (let item of cart) {
                await new Promise((resolve, reject) => {
                    Order.addItem(orderId, item.id, item.productName, item.price, item.quantity, err => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }

            for (let item of cart) {
                await new Promise(resolve => {
                    Product.reduceStock(item.id, item.quantity, () => resolve());
                });
            }

            req.session.cart = [];

            res.redirect("/checkout/success?orderId=" + orderId);

        } catch (err) {
            console.error("Checkout error:", err);
            req.flash("error", "Checkout failed, please try again.");
            res.redirect("/cart");
        }
    },

    successPage: (req, res) => {
        const orderId = req.query.orderId || null;
        res.render("checkoutSuccess", { orderId });
    }
};

module.exports = CartController;
