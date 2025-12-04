// app.js
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const methodOverride = require('method-override');
const path = require('path');
require('dotenv').config();
const fs = require('fs');
const app = express();

// Controllers + Models
const ProductController = require('./controllers/productController');
const CartController = require('./controllers/cartController');
const UserController = require('./controllers/userController');
const InvoiceController = require('./controllers/invoiceController.js');
const OrderController = require('./controllers/orderController');
const Product = require('./models/Product');
const Cart = require('./models/Cart');


const imagesDir = path.join(__dirname, 'public', 'images');
if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
}

// Multer (file upload)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/images'),
    filename: (req, file, cb) =>
        cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Express config
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));
app.use(methodOverride('_method'));

app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "interest-cohort=()");  
    next();
});

// Session + Flash
app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));
app.use(flash());

// GLOBAL middleware
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
            console.log(err);
            res.locals.cartCount = 0;
        } else {
            res.locals.cartCount = items.length || 0;
        }
        next();
    });
});

// Authentication middlewares
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash("error", "Please log in first.");
    res.redirect("/login");
};

const ensure2FA = (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    if (!req.session.user.twofa_enabled) {
        req.flash("error", "Please enable 2FA first.");
        return res.redirect("/2fa/setup");
    }
    next();
};

const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === "admin") return next();
    req.flash("error", "Access denied.");
    res.redirect("/shopping");
};

// ----------------------------
// HOME PAGE (products included)
// ----------------------------
app.get('/', (req, res) => {
    Product.getAll((err, products) => {
        if (err) {
            console.error("Home Product.getAll error:", err);
            return res.render('index', { 
                user: req.session.user || null,
                products: []
            });
        }

        if (!Array.isArray(products)) products = [];

        res.render('index', {
            user: req.session.user || null,
            products
        });
    });
});

// AUTH ROUTES
app.get('/register', UserController.registerForm);
app.post('/register', UserController.register);
app.get('/login', UserController.loginForm);
app.post('/login', UserController.login);
app.get('/logout', UserController.logout);

// PROFILE ROUTES
app.get('/profile', checkAuthenticated, ensure2FA, UserController.profile);
app.get('/profile/change-password', checkAuthenticated, ensure2FA, UserController.changePasswordForm);
app.post('/profile/change-password', checkAuthenticated, ensure2FA, UserController.changePassword);

// 2FA ROUTES
app.get('/2fa/setup', checkAuthenticated, UserController.show2FASetup);
app.post('/2fa/setup', checkAuthenticated, UserController.verify2FASetup);
app.get('/2fa/verify', UserController.show2FAVerify);
app.post('/2fa/verify', UserController.verify2FAVerify);

// SHOPPING + PRODUCT
app.get('/shopping', ProductController.list);
app.get('/product/:id', ProductController.getById);

// ADMIN INVENTORY
app.get('/inventory', checkAuthenticated, ensure2FA, checkAdmin, ProductController.list);

app.get('/addproduct', checkAuthenticated, ensure2FA, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});

app.post('/addproduct',
    checkAuthenticated,
    ensure2FA,
    checkAdmin,
    upload.single("image"),
    ProductController.add
);

// UPDATE PRODUCT
app.get('/updateproduct/:id', checkAuthenticated, ensure2FA, checkAdmin, (req, res) => {
    Product.getById(req.params.id, (err, product) => {
        if (err) return res.status(500).send("Error");
        if (!product) return res.status(404).send("Not found");
        res.render("updateProduct", { product, user: req.session.user });
    });
});

app.post('/updateproduct/:id',
    checkAuthenticated,
    ensure2FA,
    checkAdmin,
    upload.single("image"),
    ProductController.update
);

// DELETE PRODUCT
app.post('/deleteproduct/:id',
    checkAuthenticated,
    ensure2FA,
    checkAdmin,
    ProductController.delete
);

// CART
app.post('/add-to-cart/:id', checkAuthenticated, ensure2FA, CartController.add);
app.get('/cart', checkAuthenticated, ensure2FA, CartController.view);
app.post('/cart/delete/:id', checkAuthenticated, ensure2FA, CartController.delete);
app.post('/cart/update/:id', checkAuthenticated, ensure2FA, CartController.updateQuantity);

// CHECKOUT
app.get('/checkout', checkAuthenticated, ensure2FA, CartController.checkoutPage);
app.post('/checkout/confirm', checkAuthenticated, ensure2FA, CartController.confirmOrder);
app.get('/checkout/success', checkAuthenticated, ensure2FA, CartController.successPage);

// ORDERS + INVOICE
app.get('/orders', checkAuthenticated, ensure2FA, OrderController.list);
app.get('/invoice/:id', checkAuthenticated, ensure2FA, InvoiceController.download);

// ADMIN — View ALL customer orders
app.get('/admin/orders', checkAuthenticated, ensure2FA, checkAdmin, OrderController.adminList);

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running at http://localhost:" + PORT));
