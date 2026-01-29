// controllers/cartController.js
const Product = require('../models/Product');
const Order = require('../models/Order');
const Cart = require('../models/Cart');

const CartController = {

    // ------------------------------------------------
    // ADD TO CART (live stock deduction)
    // ------------------------------------------------
    add: (req, res) => {
        const userId = req.session.user.id;
        const productId = req.params.id;
        let qtyToAdd = Number(req.body.quantity);

        // Treat the incoming quantity as "add this many more"
        if (!qtyToAdd || qtyToAdd < 1) qtyToAdd = 1;

        Product.getById(productId, (err, product) => {
            if (err || !product) {
                req.flash("error", "Product not found.");
                return res.redirect("/shopping");
            }

            // Out of stock
            const currentStock = Number(product.quantity);
            if (currentStock <= 0) {
                req.flash("stockError", `${product.productName} is out of stock.`);
                return res.redirect("/shopping");
            }

            // Get cart to check existing quantity (for messaging only)
            Cart.getCart(userId, (err2, cartItems) => {
                if (err2) {
                    req.flash("error", "Failed to load cart");
                    return res.redirect("/shopping");
                }

                const existingItem = cartItems.find(i => Number(i.product_id) === Number(productId));
                const inCartNow = existingItem ? Number(existingItem.quantity) : 0;

                // Clamp to what is actually available to add right now
                if (qtyToAdd > currentStock) {
                    qtyToAdd = currentStock;
                    req.flash(
                        "stockError",
                        `Only ${currentStock} more ${product.productName} available. ` +
                        `We added ${qtyToAdd}. Your cart now has ${inCartNow + qtyToAdd}.`
                    );
                } else {
                    req.flash("success", "Item added to cart.");
                }

                if (qtyToAdd <= 0) {
                    return res.redirect("/shopping");
                }

                // Add or update cart using additive quantity
                Cart.addItem(userId, productId, qtyToAdd, (err3, result) => {
                    if (err3) {
                        console.error("Cart.addItem error:", err3);
                        req.flash("error", "Unable to add to cart.");
                        return res.redirect("/shopping");
                    }

                    const added = result?.added ?? qtyToAdd;

                    if (added <= 0) {
                        req.flash("stockError", `${product.productName} is out of stock.`);
                        return res.redirect("/shopping");
                    }

                    // Reduce stock by the actual amount added
                    Product.reduceStock(productId, added, (err4) => {
                        if (err4) {
                            console.error("Stock update error:", err4);
                            req.flash("error", "Cart added but stock update failed.");
                            return res.redirect("/cart");
                        }

                        return res.redirect("/cart");
                    });
                });
            });
        });
    },


    // ------------------------------------------------
    // VIEW CART
    // ------------------------------------------------
    view: (req, res) => {
        const userId = req.session.user.id;

        Cart.getCart(userId, (err, cartItems) => {
            if (err) {
                console.error("Cart.getCart error:", err);
                req.flash("error", "Failed to load cart");
                return res.redirect("/shopping");
            }

            res.render("cart", { cart: cartItems });
        });
    },

    // ------------------------------------------------
    // DELETE CART ITEM (restore stock)
    // ------------------------------------------------
    delete: (req, res) => {
        const cartId = req.params.id;

        Cart.getItemById(cartId, (err, item) => {
            if (err) {
                console.error("Cart.getItemById error:", err);
                req.flash("error", "Failed to remove item");
                return res.redirect("/cart");
            }

            Cart.deleteItem(cartId, (err2) => {
                if (err2) {
                    req.flash("error", "Failed to remove item");
                    return res.redirect("/cart");
                }

                // ✔ FIXED: convert to integers
                if (item) {
                    Product.increaseStock(
                        Number(item.product_id),
                        Number(item.quantity),
                        (err3) => {
                            if (err3) console.error("increaseStock error:", err3);

                            req.flash("success", "Item removed from cart");
                            return res.redirect("/cart");
                        }
                    );
                } else {
                    req.flash("success", "Item removed from cart");
                    return res.redirect("/cart");
                }
            });
        });
    },


    // ------------------------------------------------
    // UPDATE CART QUANTITY
    // ------------------------------------------------
    updateQuantity: (req, res) => {
        const cartId = req.params.id;
        let qty = parseInt(req.body.quantity, 10);

        if (!qty || qty < 1) qty = 1;

        const userId = req.session.user.id;

        Cart.getCart(userId, (err, cartItems) => {
            if (err) {
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

                const currentStock = Number(product.quantity) || 0;
                const inCartNow = Number(item.quantity) || 0;

                // Maximum user can have = DB stock + their current cart quantity
                let maxQty = currentStock + inCartNow;

                // SAFETY: if maxQty becomes 0 but user had items in cart, use inCartNow
                if (maxQty === 0 && inCartNow > 0) {
                    maxQty = inCartNow;
                }

                if (qty > maxQty) {
                    qty = maxQty;
                    req.flash(
                        "stockError",
                        `Maximum stock available for ${product.productName} is ${maxQty}. ` +
                        `Your cart quantity has been set to ${maxQty}.`
                    );
                } else {
                    req.flash("success", "Cart updated.");
                }

                Cart.updateQuantity(cartId, qty, (err3) => {
                    if (err3) {
                        req.flash("error", "Failed to update cart");
                        return res.redirect("/cart");
                    }

                    const diff = qty - inCartNow;

                    if (diff > 0) {
                        // Increase cart → reduce stock
                        Product.reduceStock(item.product_id, diff, () => res.redirect("/cart"));
                    } else if (diff < 0) {
                        // Decrease cart → restore stock
                        Product.increaseStock(item.product_id, Math.abs(diff), () => res.redirect("/cart"));
                    } else {
                        return res.redirect("/cart");
                    }
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
                return res.redirect("/shopping");
            }

            if (cart.length === 0) {
                req.flash("error", "Your cart is empty");
                return res.redirect("/shopping");
            }

            let total = 0;
            cart.forEach(i => total += Number(i.price) * i.quantity);

            const Delivery = require("../services/deliveryService");
            const Benefits = require("../services/benefits");
            const eta = Delivery.computeETA({ deliveryType: "NOW", total });

            Benefits.computeTotalWithBenefits(userId, cart).then((benefits) => {
                res.render("checkout", {
                    cart,
                    total: benefits.total,
                    benefits,
                    eta,
                    paypalClientId: process.env.PAYPAL_CLIENT_ID,
                    currency: process.env.PAYPAL_CURRENCY || "SGD",
                    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ""
                });
            }).catch(() => {
                res.render("checkout", {
                    cart,
                    total,
                    benefits: { base: total, deliveryFee: 2.0, discount: 0, plan: "NONE", total },
                    eta,
                    paypalClientId: process.env.PAYPAL_CLIENT_ID,
                    currency: process.env.PAYPAL_CURRENCY || "SGD",
                    stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ""
                });
            });
        });
    },

    // ------------------------------------------------
    // CONFIRM ORDER
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

            let total = 0;
            cart.forEach(i => total += Number(i.price) * i.quantity);

            const orderId = await new Promise((resolve, reject) => {
                Order.create(user.id, total, (err, id) => {
                    if (err) return reject(err);
                    resolve(id);
                });
            });

            for (let item of cart) {
                await new Promise((resolve, reject) => {
                    Order.addItem(
                        orderId,
                        item.product_id,
                        item.productName,
                        item.price,
                        item.quantity,
                        (err) => err ? reject(err) : resolve()
                    );
                });
            }

            await new Promise((resolve, reject) => {
                Cart.clearCart(user.id, (err) => err ? reject(err) : resolve());
            });

            res.redirect("/checkout/success?orderId=" + orderId);

        } catch (err) {
            console.error("Checkout error:", err);
            req.flash("error", "Checkout failed, please try again.");
            res.redirect("/cart");
        }
    },

    // -------------------------------------
    // SUCCESS PAGE
    // -------------------------------------
    successPage: (req, res) => {
        const orderId = req.query.orderId;

        if (!orderId) {
            return res.render("checkoutSuccess", { order: null, items: [] });
        }

        Order.getOrderWithItems(orderId, (err, order, items) => {
            if (err) {
                req.flash("error", "Failed to load order details");
                return res.redirect("/orders");
            }

            res.render("checkoutSuccess", { order, items, user: req.session.user });
        });
    }

};

module.exports = CartController;
