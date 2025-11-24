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
const InvoiceController = require('./controllers/invoiceController');
const OrderController = require('./controllers/orderController');

const Product = require('./models/Product');

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

app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.messages = req.flash();
    res.locals.cartCount = (req.session.cart || []).length;
    next();
});

// ----------------------------
// Middleware
// ----------------------------
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Please log in first');
    res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    req.flash('error', 'Access denied');
    res.redirect('/shop');
};

// ----------------------------
// ROUTES
// ----------------------------

// Home – redirect based on role
app.get('/', (req, res) => {
    if (req.session.user) {
        if (req.session.user.role === 'admin') return res.redirect('/inventory');
        return res.redirect('/shop');
    }
    return res.redirect('/login');
});

// Auth
app.get('/register', UserController.registerForm);
app.post('/register', UserController.register);
app.get('/login', UserController.loginForm);
app.post('/login', UserController.login);
app.get('/logout', UserController.logout);

// Product listing
app.get('/inventory', checkAuthenticated, checkAdmin, ProductController.list);
app.get('/shop', ProductController.list);
app.get('/shopping', ProductController.list); // backup

// Product details
app.get('/product/:id', ProductController.getById);

// Admin product CRUD
app.get('/addproduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});

app.post(
    '/addproduct',
    checkAuthenticated,
    checkAdmin,
    upload.single('image'),
    ProductController.add
);

app.get(
    '/updateproduct/:id',
    checkAuthenticated,
    checkAdmin,
    (req, res) => {
        const id = req.params.id;
        Product.getById(id, (err, product) => {
            if (err) {
                console.error(err);
                return res.status(500).send('Error retrieving product');
            }
            if (!product) return res.status(404).send('Product not found');
            res.render('updateProduct', { product, user: req.session.user });
        });
    }
);

app.post(
    '/updateproduct/:id',
    checkAuthenticated,
    checkAdmin,
    upload.single('image'),
    ProductController.update
);

app.put(
    '/updateproduct/:id',
    checkAuthenticated,
    checkAdmin,
    upload.single('image'),
    ProductController.update
);

app.post(
    '/deleteproduct/:id',
    checkAuthenticated,
    checkAdmin,
    ProductController.delete
);

// Cart
app.post('/add-to-cart/:id', checkAuthenticated, CartController.add);
app.get('/cart', checkAuthenticated, CartController.view);
app.post('/cart/delete/:id', checkAuthenticated, CartController.delete);

// Checkout
app.get('/checkout', checkAuthenticated, CartController.checkoutPage);
app.post('/checkout/confirm', checkAuthenticated, CartController.confirmOrder);
app.get('/checkout/success', checkAuthenticated, CartController.successPage);

// Orders (history)
app.get('/orders', checkAuthenticated, OrderController.list);

// Invoice download
app.get('/invoice/:id', checkAuthenticated, InvoiceController.download);

// ----------------------------
// Server start
// ----------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
    console.log(`Server running on http://localhost:${PORT}`)
);
