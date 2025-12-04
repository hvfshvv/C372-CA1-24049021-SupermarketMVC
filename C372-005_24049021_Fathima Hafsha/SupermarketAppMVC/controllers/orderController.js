// controllers/orderController.js
const Order = require('../models/Order');

const OrderController = {

    // My Orders page for normal users
    list: (req, res) => {
        const user = req.session.user;

        Order.getByUser(user.id, (err, orders) => {
            if (err) {
                console.error("USER ORDERS ERROR:", err);
                return res.status(500).send("Failed to load orders");
            }
            res.render("orders", { orders, user });
        });
    },

    // ADMIN: View all orders from all users
    adminList: (req, res) => {
        Order.getAllOrders((err, results) => {
            if (err) {
                console.error("ADMIN ORDERS ERROR:", err);
                return res.status(500).send("Failed to load all orders");
            }

            res.render("adminOrders", {
                orders: results,
                user: req.session.user
            });
        });
    },

    // Stats for profile page (already used in your profile controller)
    getStats: (userId, callback) => {
        Order.getByUser(userId, (err, orders) => {
            if (err) return callback(err, null);

            const totalOrders = orders.length;
            let totalSpent = 0;

            orders.forEach(o => {
                totalSpent += Number(o.total_amount || 0);
            });

            callback(null, { totalOrders, totalSpent });
        });
    }
};

module.exports = OrderController;
