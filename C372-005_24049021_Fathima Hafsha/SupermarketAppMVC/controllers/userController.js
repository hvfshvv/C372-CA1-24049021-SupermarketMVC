const User = require('../models/User');

const UserController = {
    // Show register form
    registerForm: (req, res) => {
        res.render('register');
    },

    // Create user
    register: (req, res) => {
        User.create(req.body, (err) => {
            if (err) {
                req.flash('error', 'Registration failed');
                return res.redirect('/register');
            }
            req.flash('success', 'Registration successful! Please log in.');
            res.redirect('/login');
        });
    },

    // Show login form
    loginForm: (req, res) => {
        res.render('login', {
            messages: req.flash('error'),
            success: req.flash('success')
        });
    },

    // Login
    login: (req, res) => {
        User.verify(req.body.email, req.body.password, (err, user) => {
            if (!user) {
                req.flash('error', 'Invalid email or password');
                return res.redirect('/login');
            }

            req.session.user = user;

            if (user.role === 'admin') return res.redirect('/inventory');
            res.redirect('/shopping');
        });
    },

    // Logout
    logout: (req, res) => {
        req.session.destroy(() => res.redirect('/'));
    }
};

module.exports = UserController;
