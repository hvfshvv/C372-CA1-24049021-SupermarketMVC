// controllers/userController.js
const speakeasy = require("speakeasy");
const qrcode = require("qrcode");
const User = require("../models/User");

const UserController = {

    // -------------------------
    // Register
    // -------------------------
    registerForm: (req, res) => {
        res.render("register");
    },

    register: (req, res) => {

        // Force role to "user" for security
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
                console.error("Register error:", err);
                req.flash("error", "Registration failed");
                return res.redirect("/register");
            }

            req.flash("success", "Registration successful! Please log in.");
            res.redirect("/login");
        });
    },

    // -------------------------
    // Login (Step 1: Password)
    // -------------------------
    loginForm: (req, res) => {
        res.render("login", {
            messages: req.flash("error"),
            success: req.flash("success")
        });
    },

    login: (req, res) => {
        const { email, password } = req.body;

        User.verify(email, password, (err, user) => {
            if (err) {
                console.error("Login error:", err);
                req.flash("error", "Login failed.");
                return res.redirect("/login");
            }

            if (!user) {
                req.flash("error", "Invalid email or password");
                return res.redirect("/login");
            }

            // User has NOT setup 2FA yet
            if (!user.twofa_enabled) {
                req.session.tempUserFor2FA = user;
                req.session.user = user; // Needed so they can access /2fa/setup
                return res.redirect("/2fa/setup");
            }

            // User already has 2FA --> move to verification step
            req.session.tempUserFor2FA = user;
            return res.redirect("/2fa/verify");
        });
    },

    // -------------------------
    // Logout
    // -------------------------
    logout: (req, res) => {
        req.session.destroy(() => res.redirect("/"));
    },

    // -------------------------
    // 2FA Setup Page
    // -------------------------
    show2FASetup: (req, res) => {
        const user = req.session.user;

        if (!user) {
            req.flash("error", "Please log in first");
            return res.redirect("/login");
        }

        if (user.twofa_enabled) {
            req.flash("success", "2FA already enabled.");
            return res.redirect("/shop");
        }

        const secret = speakeasy.generateSecret({
            name: `SupermarketAppMVC (${user.email})`,
            length: 20
        });

        req.session.temp2FASecret = secret.base32;

        qrcode.toDataURL(secret.otpauth_url, (err, qrImage) => {
            if (err) {
                console.error("QR generation error:", err);
                req.flash("error", "Failed to generate QR code");
                return res.redirect("/shop");
            }

            res.render("twofa-setup", {
                qrCode: qrImage,
                secret: secret.base32
            });
        });
    },

    // -------------------------
    // 2FA Setup Verification
    // -------------------------
    verify2FASetup: (req, res) => {
        const user = req.session.user;
        const secret = req.session.temp2FASecret;
        const token = req.body.token;

        if (!user) {
            req.flash("error", "Please log in first");
            return res.redirect("/login");
        }

        if (!secret) {
            req.flash("error", "2FA setup expired. Try again.");
            return res.redirect("/2fa/setup");
        }

        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: "base32",
            token: token,
            window: 1
        });

        if (!verified) {
            req.flash("error", "Invalid 2FA code. Try again.");
            return res.redirect("/2fa/setup");
        }

        User.enableTwoFA(user.id, secret, (err) => {
            if (err) {
                console.error("enableTwoFA error:", err);
                req.flash("error", "Failed to enable 2FA");
                return res.redirect("/2fa/setup");
            }

            user.twofa_enabled = 1;
            user.twofa_secret = secret;
            req.session.user = user;

            delete req.session.temp2FASecret;

            req.flash("success", "2FA enabled successfully!");
            return res.redirect("/shop");
        });
    },

    // -------------------------
    // 2FA Verification Page
    // -------------------------
    show2FAVerify: (req, res) => {
        const tempUser = req.session.tempUserFor2FA;

        if (!tempUser) {
            req.flash("error", "Please log in first");
            return res.redirect("/login");
        }

        res.render("twofa-verify");
    },

    // -------------------------
    // 2FA Login Action
    // -------------------------
    verify2FAVerify: (req, res) => {
        const tempUser = req.session.tempUserFor2FA;
        const token = req.body.token;

        if (!tempUser) {
            req.flash("error", "Please log in first");
            return res.redirect("/login");
        }

        const verified = speakeasy.totp.verify({
            secret: tempUser.twofa_secret,
            encoding: "base32",
            token: token,
            window: 1
        });

        if (!verified) {
            req.flash("error", "Invalid 2FA code. Try again.");
            return res.redirect("/2fa/verify");
        }

        // FINAL LOGIN SUCCESS
        req.session.user = tempUser;
        delete req.session.tempUserFor2FA;

        if (tempUser.role === "admin") return res.redirect("/inventory");

        return res.redirect("/shop");
    },

    // -------------------------
    // PROFILE PAGE
    // -------------------------
    profile: (req, res) => {
        const user = req.session.user;

        if (!user) {
            req.flash("error", "Please log in first");
            return res.redirect("/login");
        }

        const isAdmin = user.role === "admin";

        // If admin → do NOT load orders
        if (isAdmin) {
            return res.render("profile", {
                user,
                isAdmin,
                stats: null   // admin does NOT need stats
            });
        }

        // User → load order statistics
        const Order = require("../models/Order");

        Order.getByUser(user.id, (err, orders) => {
            if (err) {
                console.error("Order stats error:", err);
                return res.render("profile", {
                    user,
                    isAdmin,
                    stats: { totalOrders: 0, totalSpent: 0 }
                });
            }

            const totalOrders = orders.length;
            let totalSpent = 0;

            orders.forEach(o => {
                totalSpent += Number(o.total_amount);
            });

            const stats = {
                totalOrders,
                totalSpent
            };

            res.render("profile", {
                user,
                isAdmin,
                stats
            });
        });
    }
};

module.exports = UserController;
