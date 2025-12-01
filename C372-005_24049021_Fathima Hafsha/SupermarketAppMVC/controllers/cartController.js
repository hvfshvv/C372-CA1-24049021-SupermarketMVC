// controllers/cartController.js
const Product = require('../models/Product');
const Order = require('../models/Order');
const Cart = require('../models/Cart');

const CartController = {

    // ------------------------------------------------
    // ADD TO CART (DB cart_items)
    // ------------------------------------------------
    add: (req, res) => {
        const productId = req.params.id;
        const qty = parseInt(req.body.quantity) || 1;
        const userId = req.session.user.id;

        Product.getById(productId, (err, product) => {
            if (err || !product) {
                req.flash("error", "Product not found");
                return res.redirect("/shop");
            }

            if (qty > product.quantity) {
                req.flash("error", `Only ${product.quantity} left in stock`);
                return res.redirect("/product/" + productId);
            }

            Cart.addItem(userId, productId, qty, (err2) => {
                if (err2) {
                    console.error("Cart.addItem error:", err2);
                    req.flash("error", "Failed to add to cart");
                    return res.redirect("/shop");
                }

                req.flash("success", "Item added to cart");
                res.redirect("/cart");
            });
        });
    },

    // ------------------------------------------------
    // VIEW CART (DB-based cart)
    // ------------------------------------------------
    view: (req, res) => {
        const userId = req.session.user.id;

        Cart.getCart(userId, (err, cartItems) => {
            if (err) {
                console.error("Cart.getCart error:", err);
                req.flash("error", "Failed to load cart");
                return res.redirect("/shop");
            }

            res.render("cart", { cart: cartItems });
        });
    },

    // ------------------------------------------------
    // DELETE CART ITEM
    // ------------------------------------------------
    delete: (req, res) => {
        const cartId = req.params.id;

        Cart.deleteItem(cartId, (err) => {
            if (err) {
                console.error("Cart.deleteItem error:", err);
                req.flash("error", "Failed to remove item");
            } else {
                req.flash("success", "Item removed from cart");
            }
            res.redirect("/cart");
        });
    },

    // ------------------------------------------------
    // UPDATE CART QUANTITY
    // ------------------------------------------------
    updateQuantity: (req, res) => {
        const cartId = req.params.id;
        let qty = parseInt(req.body.quantity);

        if (!qty || qty < 1) qty = 1;

        const userId = req.session.user.id;

        Cart.getCart(userId, (err, cartItems) => {
            if (err) {
                console.error("Cart.getCart error:", err);
                req.flash("error", "Failed to update cart");
                return res.redirect("/cart");
            }

            const item = cartItems.find(i => String(i.cart_id) === String(cartId));
            if (!item) {
                req.flash("error", "Cart item not found");
                return res.redirect("/cart");
            }

            Product.getById(item.product_id, (err2, product) => {
                if (err2 || !product) {
                    req.flash("error", "Product not found");
                    return res.redirect("/cart");
                }

                if (qty > product.quantity) {
                    req.flash("error", `Only ${product.quantity} left in stock`);
                    return res.redirect("/cart");
                }

                Cart.updateQuantity(cartId, qty, (err3) => {
                    if (err3) {
                        console.error("Cart.updateQuantity error:", err3);
                        req.flash("error", "Failed to update cart");
                    } else {
                        req.flash("success", "Cart updated!");
                    }
                    res.redirect("/cart");
                });
            });
        });
    },

    // ------------------------------------------------
    // CHECKOUT PAGE
    // ------------------------------------------------
    checkoutPage: (req, res) => {
        const userId = req.session.user.id;

        Cart.getCart(userId, (err, cart) => {
            if (err || !cart) {
                req.flash("error", "Failed to load cart");
                return res.redirect("/shop");
            }

            if (cart.length === 0) {
                req.flash("error", "Your cart is empty");
                return res.redirect("/shop");
            }

            let total = 0;
            cart.forEach(i => total += Number(i.price) * i.quantity);

            res.render("checkout", { cart, total });
        });
    },

    // ------------------------------------------------
    // CONFIRM ORDER — creates order + items + deduct stock
    // ------------------------------------------------
    confirmOrder: async (req, res) => {
        const user = req.session.user;

        try {
            const cart = await new Promise((resolve, reject) => {
                Cart.getCart(user.id, (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                });
            });

            if (!cart.length) {
                req.flash("error", "Your cart is empty");
                return res.redirect("/cart");
            }

            // Check stock
            for (let item of cart) {
                const enough = await new Promise((resolve) => {
                    Product.checkStock(item.product_id, item.quantity, (err, ok) => {
                        if (err) return resolve(false);
                        resolve(ok);
                    });
                });

                if (!enough) {
                    req.flash("error", `Not enough stock for ${item.productName}`);
                    return res.redirect("/cart");
                }
            }

            // Calculate total price
            let total = 0;
            cart.forEach(i => total += Number(i.price) * i.quantity);

            // Create order
            const orderId = await new Promise((resolve, reject) => {
                Order.create(user.id, total, (err, id) => {
                    if (err) return reject(err);
                    resolve(id);
                });
            });

            // Insert order items
            for (let item of cart) {
                await new Promise((resolve, reject) => {
                    Order.addItem(
                        orderId,
                        item.product_id,
                        item.productName,
                        item.price,
                        item.quantity,
                        (err) => {
                            if (err) return reject(err);
                            resolve();
                        }
                    );
                });
            }

            // Deduct stock
            for (let item of cart) {
                await new Promise(resolve => {
                    Product.reduceStock(item.product_id, item.quantity, () => resolve());
                });
            }

            // Clear DB cart
            await new Promise((resolve, reject) => {
                Cart.clearCart(user.id, (err) => {
                    if (err) return reject(err);
                    resolve();
                });
            });

            res.redirect("/checkout/success?orderId=" + orderId);

        } catch (err) {
            console.error("Checkout error:", err);
            req.flash("error", "Checkout failed, please try again.");
            res.redirect("/cart");
        }
    },

    // -------------------------------------
    // SUCCESS PAGE — show order preview 
    // -------------------------------------
    successPage: (req, res) => {
        const orderId = req.query.orderId;

        if (!orderId) {
            return res.render("checkoutSuccess", { order: null, items: [] });
        }

        Order.getOrderWithItems(orderId, (err, order, items) => {
            if (err) {
                console.error("getOrderWithItems error:", err);
                req.flash("error", "Failed to load order details");
                return res.redirect("/orders");
            }

            res.render("checkoutSuccess", { order, items });
        });
    }

};

module.exports = CartController;
