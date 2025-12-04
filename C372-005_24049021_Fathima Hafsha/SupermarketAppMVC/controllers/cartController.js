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
        let quantity = Number(req.body.quantity);

        if (!quantity || quantity < 1) quantity = 1;

        // 1. Get product first
        Product.getById(productId, (err, product) => {
            if (err || !product) {
                req.flash("error", "Product not found.");
                return res.redirect("/shop");
            }

            // No stock at all
            if (product.quantity <= 0) {
                req.flash("stockError", `${product.productName} is out of stock.`);
                return res.redirect("/shop");
            }

            // 2. Clamp to available stock
            if (quantity > product.quantity) {
                quantity = product.quantity;
                req.flash(
                    "stockError",
                    `Maximum stock available for ${product.productName} is ${product.quantity}. ` +
                    `Your cart quantity has been set to ${product.quantity}.`
                );
            } else {
                req.flash("success", "Item added to cart.");
            }

            // 3. Add to cart
            Cart.addItem(userId, productId, quantity, (err2) => {
                if (err2) {
                    console.error("Cart.addItem error:", err2);
                    req.flash("error", "Unable to add to cart.");
                    return res.redirect("/shop");
                }

                // 4. Reduce stock by the quantity actually added
                Product.reduceStock(productId, quantity, (err3) => {
                    if (err3) {
                        console.error("Stock update error:", err3);
                        req.flash("error", "Cart added but stock update failed.");
                        return res.redirect("/cart");
                    }

                    res.redirect("/cart");
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
                return res.redirect("/shop");
            }

            res.render("cart", { cart: cartItems });
        });
    },

    // ------------------------------------------------
    // DELETE CART ITEM (restore full stock)
    // ------------------------------------------------
    delete: (req, res) => {
        const cartId = req.params.id;

        // 1. Get the cart item to know product + qty
        Cart.getItemById(cartId, (err, item) => {
            if (err) {
                console.error("Cart.getItemById error:", err);
                req.flash("error", "Failed to remove item");
                return res.redirect("/cart");
            }

            // 2. Delete the row from cart
            Cart.deleteItem(cartId, (err2) => {
                if (err2) {
                    console.error("Cart.deleteItem error:", err2);
                    req.flash("error", "Failed to remove item");
                    return res.redirect("/cart");
                }

                // 3. Restore stock if we know the item
                if (item) {
                    Product.increaseStock(item.product_id, item.quantity, (err3) => {
                        if (err3) {
                            console.error("increaseStock error:", err3);
                        }
                        req.flash("success", "Item removed from cart");
                        return res.redirect("/cart");
                    });
                } else {
                    req.flash("success", "Item removed from cart");
                    return res.redirect("/cart");
                }
            });
        });
    },

    // ------------------------------------------------
    // UPDATE CART QUANTITY (live stock adjust by diff)
    // ------------------------------------------------
    updateQuantity: (req, res) => {
        const cartId = req.params.id;
        let qty = parseInt(req.body.quantity, 10);

        if (!qty || qty < 1) qty = 1;

        const userId = req.session.user.id;

        // 1. Get all cart items for user
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

            // 2. Get product info
            Product.getById(item.product_id, (err2, product) => {
                if (err2 || !product) {
                    console.error("Product.getById error:", err2);
                    req.flash("error", "Product not found");
                    return res.redirect("/cart");
                }

                // currentStock = product.quantity (remaining in DB)
                // oldCartQty   = item.quantity
                // max user can have = currentStock + oldCartQty
                const maxQty = product.quantity + item.quantity;

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

                // 3. Update cart first
                Cart.updateQuantity(cartId, qty, (err3) => {
                    if (err3) {
                        console.error("Cart.updateQuantity error:", err3);
                        req.flash("error", "Failed to update cart");
                        return res.redirect("/cart");
                    }

                    // 4. Adjust stock by the difference
                    const diff = qty - item.quantity;

                    if (diff > 0) {
                        // User increased qty → reduce stock
                        Product.reduceStock(item.product_id, diff, (err4) => {
                            if (err4) {
                                console.error("reduceStock error:", err4);
                            }
                            return res.redirect("/cart");
                        });
                    } else if (diff < 0) {
                        // User decreased qty → restore stock
                        Product.increaseStock(item.product_id, Math.abs(diff), (err4) => {
                            if (err4) {
                                console.error("increaseStock error:", err4);
                            }
                            return res.redirect("/cart");
                        });
                    } else {
                        // No change
                        return res.redirect("/cart");
                    }
                });
            });
        });
    },

    // ------------------------------------------------
    // CHECKOUT PAGE (display only – stock already handled)
    // ------------------------------------------------
    checkoutPage: (req, res) => {
        const userId = req.session.user.id;

        Cart.getCart(userId, (err, cart) => {
            if (err || !cart) {
                console.error("checkoutPage Cart.getCart error:", err);
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
    // CONFIRM ORDER — stock already deducted (Option A)
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

            // 1. Create order
            const orderId = await new Promise((resolve, reject) => {
                Order.create(user.id, total, (err, id) => {
                    if (err) return reject(err);
                    resolve(id);
                });
            });

            // 2. Add items to order
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

            // 3. DO NOT change stock here (already handled in cart)

            // 4. Clear cart
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
