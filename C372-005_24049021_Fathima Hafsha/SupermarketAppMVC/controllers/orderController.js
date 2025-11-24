const Order = require('../models/Order');

const OrderController = {
    list: (req, res) => {
        const user = req.session.user;

        Order.getByUser(user.id, (err, orders) => {
            if (err) return res.status(500).send("Failed to load orders");
            res.render("orders", { orders });
        });
    }
};

module.exports = OrderController;
