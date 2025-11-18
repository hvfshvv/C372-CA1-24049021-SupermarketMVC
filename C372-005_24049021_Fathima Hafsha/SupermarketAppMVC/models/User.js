const db = require('../db');

const User = {
    create: (user, callback) => {
        const sql = `
            INSERT INTO users (username, email, password, address, contact, role)
            VALUES (?, ?, SHA1(?), ?, ?, ?)
        `;
        db.query(sql, [
            user.username,
            user.email,
            user.password,
            user.address,
            user.contact,
            user.role
        ], callback);
    },

    verify: (email, password, callback) => {
        const sql = 'SELECT * FROM users WHERE email=? AND password=SHA1(?)';
        db.query(sql, [email, password], (err, results) =>
            callback(err, results?.[0] || null)
        );
    }
};

module.exports = User;
