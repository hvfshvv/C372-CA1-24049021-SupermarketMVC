const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const methodOverride = require('method-override');
require('dotenv').config();

const app = express();

// Controllers
const ProductController = require('./controllers/productController');
const CartController = require('./controllers/cartController');
const UserController = require('./controllers/userController');

// Models
const Product = require('./models/Product');

// ------------------------------------
// FILE UPLOAD (multer)
// ------------------------------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/images'),
    filename: (req, file, cb) =>
        cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ------------------------------------
// MIDDLEWARE
// ------------------------------------
app.use(methodOverride('_method'));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));

app.use(session({
    secret: 'supersecret',
    resave: false,
    saveUninitialized: true
}));
app.use(flash());

// Make session and flash available in EJS
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.messages = req.flash();
    next();
});

// Login check
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Please log in first.');
    res.redirect('/login');
};

// Admin check
const checkAdmin = (req, res, next) => {
    if (req.session.user?.role === 'admin') return next();
    req.flash('error', 'Access denied.');
    res.redirect('/shopping');
};

// ------------------------------------
// ROUTES
// ------------------------------------

// Home redirect
app.get('/', (req, res) => {
    if (req.session.user?.role === 'admin') return res.redirect('/inventory');
    if (req.session.user) return res.redirect('/shopping');
    res.redirect('/login');
});

// USER AUTH
app.get('/register', UserController.registerForm);
app.post('/register', UserController.register);

app.get('/login', UserController.loginForm);
app.post('/login', UserController.login);

app.get('/logout', UserController.logout);

// PRODUCT LISTING
app.get('/inventory', checkAuthenticated, checkAdmin, ProductController.list);
app.get('/shopping', ProductController.list);

// PRODUCT DETAILS
app.get('/product/:id', ProductController.getById);

// PRODUCT CRUD
app.get('/addproduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct');
});
app.post('/addproduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.add);

app.get('/updateproduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
    Product.getById(req.params.id, (err, product) => {
        if (!product) return res.status(404).send('Product not found');
        res.render('updateProduct', { product });
    });
});

app.put('/updateproduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.update);
app.delete('/deleteproduct/:id', checkAuthenticated, checkAdmin, ProductController.delete);

// CART ROUTES
app.post('/add-to-cart/:id', checkAuthenticated, CartController.add);
app.get('/cart', checkAuthenticated, CartController.view);
app.post('/cart/delete/:id', checkAuthenticated, CartController.delete);
app.delete('/cart/delete/:id', checkAuthenticated, CartController.delete);

// ------------------------------------
// SERVER START
// ------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
