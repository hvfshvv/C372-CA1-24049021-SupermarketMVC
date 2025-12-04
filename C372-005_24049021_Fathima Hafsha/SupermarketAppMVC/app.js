// app.js
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const methodOverride = require('method-override');
const path = require('path');
require('dotenv').config();

const app = express();

// ----------------------------
// Controllers + Models
// ----------------------------
const ProductController = require('./controllers/productController');
const CartController = require('./controllers/cartController');
const UserController = require('./controllers/userController');
const InvoiceController = require('./controllers/invoiceController.js');
const OrderController = require('./controllers/orderController');
const Product = require('./models/Product');
const Cart = require('./models/Cart');

// ----------------------------
// Multer (file upload)
// ----------------------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/images'),
    filename: (req, file, cb) =>
        cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ----------------------------
// Express config
// ----------------------------
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));

// ----------------------------
// Session + Flash
// ----------------------------
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

// ----------------------------
// GLOBAL MIDDLEWARE
// Make user + flash + cartCount available to all views
// ----------------------------
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.messages = req.flash();

    const user = req.session.user;
    if (!user) {
        res.locals.cartCount = 0;
        return next();
    }

    Cart.getCart(user.id, (err, items) => {
        if (err) {
            console.error("Navbar Cart.getCart error:", err);
            res.locals.cartCount = 0;
        } else {
            res.locals.cartCount = items.length || 0;
        }
        next();
    });
});

// ----------------------------
// Middleware
// ----------------------------
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Please log in first.');
    res.redirect('/login');
};

const ensure2FA = (req, res, next) => {
    const user = req.session.user;

    if (!user) {
        req.flash('error', 'Please log in first.');
        return res.redirect('/login');
    }

    if (!user.twofa_enabled) {
        req.flash('error', 'Please enable 2FA before continuing.');
        return res.redirect('/2fa/setup');
    }

    next();
};

const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    req.flash('error', 'Access denied.');
    res.redirect('/shopping');
};

// ----------------------------
// HOME PAGE (index.ejs)
// Now loads products for the homepage slider
// ----------------------------
app.get('/', (req, res) => {
    Product.getAll((err, products) => {
        if (err) {
            console.error("Home Product.getAll error:", err);
            return res.render('index', { user: req.session.user || null, products: [] });
        }

        res.render('index', {
            user: req.session.user || null,
            products
        });
    });
});

// ----------------------------
// AUTH ROUTES
// ----------------------------
app.get('/register', UserController.registerForm);
app.post('/register', UserController.register);
app.get('/login', UserController.loginForm);
app.post('/login', UserController.login);
app.get('/logout', UserController.logout);

// ----------------------------
// PROFILE ROUTES
// ----------------------------
app.get('/profile', checkAuthenticated, ensure2FA, UserController.profile);

app.get('/profile/change-password',
    checkAuthenticated,
    ensure2FA,
    UserController.changePasswordForm
);

app.post('/profile/change-password',
    checkAuthenticated,
    ensure2FA,
    UserController.changePassword
);

// ----------------------------
// 2FA ROUTES
// ----------------------------
app.get('/2fa/setup', checkAuthenticated, UserController.show2FASetup);
app.post('/2fa/setup', checkAuthenticated, UserController.verify2FASetup);

app.get('/2fa/verify', UserController.show2FAVerify);
app.post('/2fa/verify', UserController.verify2FAVerify);

// ----------------------------
// PRODUCTS
// ----------------------------
app.get('/shopping', ProductController.list);
app.get('/product/:id', ProductController.getById);

// ----------------------------
// ADMIN INVENTORY
// ----------------------------
app.get('/inventory', checkAuthenticated, ensure2FA, checkAdmin, ProductController.list);

app.get('/addproduct', checkAuthenticated, ensure2FA, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});

app.post(
    '/addproduct',
    checkAuthenticated,
    ensure2FA,
    checkAdmin,
    upload.single('image'),
    ProductController.add
);

app.get(
    '/updateproduct/:id',
    checkAuthenticated,
    ensure2FA,
    checkAdmin,
    (req, res) => {
        const id = req.params.id;
        Product.getById(id, (err, product) => {
            if (err) return res.status(500).send('Error retrieving product');
            if (!product) return res.status(404).send('Product not found');
            res.render('updateProduct', { product, user: req.session.user });
        });
    }
);

app.post(
    '/updateproduct/:id',
    checkAuthenticated,
    ensure2FA,
    checkAdmin,
    upload.single('image'),
    ProductController.update
);

app.post(
    '/deleteproduct/:id',
    checkAuthenticated,
    ensure2FA,
    checkAdmin,
    ProductController.delete
);

// ----------------------------
// CART ROUTES
// ----------------------------
app.post('/add-to-cart/:id', checkAuthenticated, ensure2FA, CartController.add);
app.get('/cart', checkAuthenticated, ensure2FA, CartController.view);
app.post('/cart/delete/:id', checkAuthenticated, ensure2FA, CartController.delete);
app.post('/cart/update/:id', checkAuthenticated, ensure2FA, CartController.updateQuantity);

// ----------------------------
// CHECKOUT
// ----------------------------
app.get('/checkout', checkAuthenticated, ensure2FA, CartController.checkoutPage);
app.post('/checkout/confirm', checkAuthenticated, ensure2FA, CartController.confirmOrder);
app.get('/checkout/success', checkAuthenticated, ensure2FA, CartController.successPage);

// ----------------------------
// ORDERS + INVOICE
// ----------------------------
app.get('/orders', checkAuthenticated, ensure2FA, (req, res, next) => {
    if (req.session.user.role === "admin") {
        req.flash("error", "Admins cannot view user orders.");
        return res.redirect("/inventory");
    }
    next();
}, OrderController.list);

app.get('/invoice/:id', checkAuthenticated, ensure2FA, InvoiceController.download);

// ----------------------------
// START SERVER
// ----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
    console.log(`Server running on http://localhost:${PORT}`)
);
