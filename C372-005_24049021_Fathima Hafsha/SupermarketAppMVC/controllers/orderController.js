const Order = require('../models/Order');

const OrderController = {

    // DEFAULT: My Orders page for users only
    list: (req, res) => {
        const user = req.session.user;

        Order.getByUser(user.id, (err, orders) => {
            if (err) return res.status(500).send("Failed to load orders");
            res.render("orders", { orders });
        });
    },

    // EXTRA: Return total orders + total spend for profile page
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
