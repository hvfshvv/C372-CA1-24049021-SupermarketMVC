// models/User.js
const db = require('../db');

const User = {

    // --------------------------------------------------
    // Create new user
    // --------------------------------------------------
    create: (user, callback) => {
        const sql = `
            INSERT INTO users (username, email, password, address, contact, role, twofa_enabled, twofa_secret)
            VALUES (?, ?, SHA1(?), ?, ?, ?, 0, NULL)
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

    // --------------------------------------------------
    // Verify email + password (Step 1 login)
    // --------------------------------------------------
    verify: (email, password, callback) => {
        const sql = `
            SELECT *
            FROM users
            WHERE email = ? AND password = SHA1(?)
        `;

        db.query(sql, [email, password], (err, results) => {
            if (err) return callback(err);
            return callback(null, results?.[0] || null);
        });
    },

    // --------------------------------------------------
    // Enable 2FA (save secret into DB)
    // --------------------------------------------------
    enableTwoFA: (userId, secret, callback) => {
        const sql = `
            UPDATE users
            SET twofa_secret = ?, twofa_enabled = 1
            WHERE id = ?
        `;
        db.query(sql, [secret, userId], callback);
    },

    // --------------------------------------------------
    // Disable 2FA
    // --------------------------------------------------
    disableTwoFA: (userId, callback) => {
        const sql = `
            UPDATE users
            SET twofa_secret = NULL, twofa_enabled = 0
            WHERE id = ?
        `;
        db.query(sql, [userId], callback);
    },

    // --------------------------------------------------
    // UPDATE PASSWORD  ✅ FIXED (now inside User object)
    // --------------------------------------------------
    updatePassword: (userId, newPassword, callback) => {
        const sql = `
            UPDATE users
            SET password = SHA1(?)
            WHERE id = ?
        `;
        db.query(sql, [newPassword, userId], callback);
    }

};

module.exports = User;
