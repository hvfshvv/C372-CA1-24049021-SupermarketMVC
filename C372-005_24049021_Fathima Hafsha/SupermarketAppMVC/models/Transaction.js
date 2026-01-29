const db = require('../db');

const Transaction = {

    create(data, callback) {
        const sql = `
        INSERT INTO transactions
        (orderId, payerId, payerEmail, amount, currency, status, time, payment_method, payment_ref, capture_id, refund_id, refund_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

        const values = [
            data.orderId, data.payerId, data.payerEmail,
            data.amount, data.currency, data.status, data.time,
            data.paymentMethod || null,
            data.paymentRef || null,
            data.captureId || null,
            data.refundId || null,
            data.refundStatus || null
        ];

        db.query(sql, values, callback);
    },

    getLatestByOrder(orderId, callback) {
        const sql = `
            SELECT * FROM transactions
            WHERE orderId = ?
            ORDER BY time DESC, id DESC
            LIMIT 1
        `;
        db.query(sql, [orderId], (err, rows) => {
            if (err) return callback(err);
            callback(null, rows && rows[0] ? rows[0] : null);
        });
    }

};

module.exports = Transaction;
