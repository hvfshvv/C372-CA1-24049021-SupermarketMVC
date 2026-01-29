const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const User = require("../models/User");
const Order = require("../models/Order");

const UserController = {
    // Register
    registerForm: (req, res) => res.render("register"),
    register: (req, res) => {
        const newUser = {
            username: req.body.username,
            email: req.body.email,
            password: req.body.password,
            address: req.body.address,
            contact: req.body.contact,
            role: "user"
        };
        User.create(newUser, (err) => {
            if (err) {
                req.flash("error", "Registration failed");
                return res.redirect("/register");
            }
            req.flash("success", "Registration successful! Please log in.");
            res.redirect("/login");
        });
    },

    // Login
    loginForm: (req, res) => {
        res.render("login", { messages: req.flash("error"), success: req.flash("success") });
    },

    login: (req, res) => {
        const { email, password } = req.body;
        User.verify(email, password, (err, user) => {
            if (err || !user) {
                req.flash("error", "Invalid email or password");
                return res.redirect("/login");
            }
            // DEMO: bypass 2FA
            req.session.user = user;
            return user.role === "admin" ? res.redirect("/inventory") : res.redirect("/shopping");
            // Original 2FA flow kept for later:
            // if (!user.twofa_enabled) {
            //     req.session.tempUserFor2FA = user;
            //     req.session.user = user;
            //     return res.redirect("/2fa/setup");
            // }
            // req.session.tempUserFor2FA = user;
            // res.redirect("/2fa/verify");
        });
    },

    // Logout
    logout: (req, res) => req.session.destroy(() => res.redirect("/")),

    // 2FA setup
    show2FASetup: (req, res) => {
        const user = req.session.user;
        if (!user) return res.redirect("/login");
        if (user.twofa_enabled) {
            req.flash("success", "2FA already enabled.");
            return res.redirect("/shopping");
        }
        const secret = speakeasy.generateSecret({ name: SupermarketAppMVC (), length: 20 });
        req.session.temp2FASecret = secret.base32;
        qrcode.toDataURL(secret.otpauth_url, (err, qrImage) => {
            res.render("twofa-setup", { qrCode: qrImage, secret: secret.base32 });
        });
    },

    verify2FASetup: (req, res) => {
        const user = req.session.user;
        const secret = req.session.temp2FASecret;
        const token = req.body.token;
        const verified = speakeasy.totp.verify({ secret, encoding: "base32", token, window: 1 });
        if (!verified) {
            req.flash("error", "Invalid 2FA code.");
            return res.redirect("/2fa/setup");
        }
        User.enableTwoFA(user.id, secret, () => {
            user.twofa_enabled = 1;
            user.twofa_secret = secret;
            req.session.user = user;
            delete req.session.temp2FASecret;
            req.flash("success", "2FA enabled successfully!");
            res.redirect("/shopping");
        });
    },

    // 2FA login
    show2FAVerify: (req, res) => {
        if (!req.session.tempUserFor2FA) return res.redirect("/login");
        res.render("twofa-verify");
    },

    verify2FAVerify: (req, res) => {
        const tempUser = req.session.tempUserFor2FA;
        const token = req.body.token;
        const verified = speakeasy.totp.verify({ secret: tempUser.twofa_secret, encoding: "base32", token, window: 1 });
        if (!verified) {
            req.flash("error", "Invalid 2FA code.");
            return res.redirect("/2fa/verify");
        }
        req.session.user = tempUser;
        delete req.session.tempUserFor2FA;
        return tempUser.role === "admin" ? res.redirect("/inventory") : res.redirect("/shopping");
    },

    // Profile
    profile: (req, res) => {
        const user = req.session.user;
        const isAdmin = user.role === "admin";
        if (isAdmin) {
            return res.render("profile", { user, isAdmin, stats: null });
        }
        Order.getByUser(user.id, (err, orders) => {
            if (err || !orders) {
                return res.render("profile", { user, isAdmin, stats: { totalOrders: 0, totalSpent: 0 } });
            }
            const stats = {
                totalOrders: orders.length,
                totalSpent: orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0)
            };
            res.render("profile", { user, isAdmin, stats });
        });
    },

    // Change password
    changePasswordForm: (req, res) => {
        res.render("changePassword", { messages: { error: req.flash("error"), success: req.flash("success") } });
    },

    changePassword: (req, res) => {
        const userId = req.session.user.id;
        const { currentPassword, newPassword, confirmPassword } = req.body;
        if (newPassword !== confirmPassword) {
            req.flash("error", "New password and confirmation do not match.");
            return res.redirect("/profile/change-password");
        }
        User.verify(req.session.user.email, currentPassword, (err, user) => {
            if (err || !user) {
                req.flash("error", "Current password is incorrect.");
                return res.redirect("/profile/change-password");
            }
            User.updatePassword(userId, newPassword, (err2) => {
                if (err2) return res.redirect("/profile?pwChanged=0");
                return res.redirect("/profile?pwChanged=1");
            });
        });
    }
};

module.exports = UserController;
