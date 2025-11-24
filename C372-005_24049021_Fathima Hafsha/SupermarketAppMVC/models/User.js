// models/User.js
const db = require('../db');

const User = {
    // Create new user
    create: (user, callback) => {
        const sql = `
            INSERT INTO users (username, email, password, address, contact, role)
            VALUES (?, ?, SHA1(?), ?, ?, ?)
        `;
        db.query(
            sql,
            [
                user.username,
                user.email,
                user.password,
                user.address,
                user.contact,
                user.role || 'user'
            ],
            callback
        );
    },

    // Verify email + password (used at login)
    verify: (email, password, callback) => {
        const sql = `
            SELECT * 
            FROM users 
            WHERE email = ? AND password = SHA1(?)
        `;
        db.query(sql, [email, password], (err, results) => {
            if (err) return callback(err);
            callback(null, results && results[0] ? results[0] : null);
        });
    },

    // Enable 2FA for user (save secret + flag)
    enableTwoFA: (userId, secret, callback) => {
        const sql = `
            UPDATE users
            SET twofa_secret = ?, twofa_enabled = 1
            WHERE id = ?
        `;
        db.query(sql, [secret, userId], callback);
    },

    // (Optional) Disable 2FA
    disableTwoFA: (userId, callback) => {
        const sql = `
            UPDATE users
            SET twofa_secret = NULL, twofa_enabled = 0
            WHERE id = ?
        `;
        db.query(sql, [userId], callback);
    }
};

module.exports = User;
