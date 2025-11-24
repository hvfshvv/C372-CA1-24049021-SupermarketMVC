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
        User.create(req.body, (err) => {
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
    // Login (Step 1: password)
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
                req.flash("error", "Login failed");
                return res.redirect("/login");
            }

            if (!user) {
                req.flash("error", "Invalid email or password");
                return res.redirect("/login");
            }

            // If user ALREADY enabled 2FA → go to 2FA verify page
            if (user.twofa_enabled) {
                req.session.tempUserFor2FA = user;
                return res.redirect("/2fa/verify");
            }

            // If user has NOT set up 2FA → force them to setup
            req.session.user = user;
            req.flash("info", "Please set up 2FA before continuing.");
            return res.redirect("/2fa/setup");
        });
    },


    // -------------------------
    // Logout
    // -------------------------
    logout: (req, res) => {
        req.session.destroy(() => res.redirect("/"));
    },

    // -------------------------
    // 2FA SETUP (for logged-in user with no 2FA yet)
    // -------------------------
    show2FASetup: (req, res) => {
        const user = req.session.user;

        if (!user) {
            req.flash("error", "Please log in first");
            return res.redirect("/login");
        }

        // If already enabled, no need to setup again
        if (user.twofa_enabled) {
            req.flash("success", "2FA is already enabled on your account.");
            return res.redirect("/shop");
        }

        // Generate secret for Google Authenticator
        const secret = speakeasy.generateSecret({
            name: `SupermarketAppMVC (${user.email})`,
            length: 20
        });

        // Store secret temporarily in session until user enters correct code
        req.session.temp2FASecret = secret.base32;

        // Generate QR code (data URL)
        qrcode.toDataURL(secret.otpauth_url, (err, qrImage) => {
            if (err) {
                console.error("QR code generation error:", err);
                req.flash("error", "Failed to generate QR code");
                return res.redirect("/shop");
            }

            res.render("twofa-setup", {
                qrCode: qrImage,
                secret: secret.base32
            });
        });
    },

    verify2FASetup: (req, res) => {
        const user = req.session.user;
        const secret = req.session.temp2FASecret;
        const token = req.body.token;

        if (!user) {
            req.flash("error", "Please log in first");
            return res.redirect("/login");
        }

        if (!secret) {
            req.flash("error", "2FA setup session expired. Please try again.");
            return res.redirect("/2fa/setup");
        }

        const verified = speakeasy.totp.verify({
            secret: secret,
            encoding: "base32",
            token: token,
            window: 1
        });

        if (!verified) {
            req.flash("error", "Invalid 2FA code. Please try again.");
            return res.redirect("/2fa/setup");
        }

        // Save secret to DB + mark enabled
        User.enableTwoFA(user.id, secret, (err) => {
            if (err) {
                console.error("enableTwoFA error:", err);
                req.flash("error", "Failed to enable 2FA. Please try again.");
                return res.redirect("/2fa/setup");
            }

            // Update session user object
            user.twofa_enabled = 1;
            user.twofa_secret = secret;
            req.session.user = user;
            delete req.session.temp2FASecret;

            req.flash("success", "2FA has been enabled on your account!");
            return res.redirect("/shop");
        });
    },

    // -------------------------
    // 2FA LOGIN VERIFY (Step 2 after password)
    // -------------------------
    show2FAVerify: (req, res) => {
        const tempUser = req.session.tempUserFor2FA;

        if (!tempUser) {
            req.flash("error", "Please log in first");
            return res.redirect("/login");
        }

        res.render("twofa-verify");
    },

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
            req.flash("error", "Invalid 2FA code. Please try again.");
            return res.redirect("/2fa/verify");
        }

        // 2FA success → fully log in user
        req.session.user = tempUser;
        delete req.session.tempUserFor2FA;

        if (tempUser.role === "admin") return res.redirect("/inventory");
        return res.redirect("/shop");
    }
};

module.exports = UserController;
