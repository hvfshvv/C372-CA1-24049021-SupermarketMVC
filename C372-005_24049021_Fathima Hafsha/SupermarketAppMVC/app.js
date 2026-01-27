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
const crypto = require("crypto");

// Controllers + Models
const ProductController = require('./controllers/productController');
const CartController = require('./controllers/cartController');
const UserController = require('./controllers/userController');
const InvoiceController = require('./controllers/invoiceController.js');
const OrderController = require('./controllers/orderController');
const NetsController = require('./controllers/netsController');
const Product = require('./models/Product');
const paypal = require('./services/paypal');
const Cart = require('./models/Cart');
const Order = require('./models/Order');
const Transaction = require("./models/Transaction");
const db = require("./db");
const stripeSdk = require("stripe");

// Reconcile any mismatched payment states on startup (avoids manual hardcoding)
async function reconcilePayments() {
    return new Promise((resolve, reject) => {
        const sql = `
        UPDATE orders o
        JOIN transactions t ON t.orderId = o.id
        SET 
            o.payment_status = CASE WHEN t.status = 'COMPLETED' THEN 'PAID' ELSE o.payment_status END,
            o.payment_method = COALESCE(o.payment_method, t.payment_method, 'UNKNOWN'),
            o.payment_ref = COALESCE(o.payment_ref, t.payment_ref, o.payment_ref),
            o.payer_email = COALESCE(o.payer_email, t.payerEmail, o.payer_email),
            o.paid_at = IFNULL(o.paid_at, t.time),
            t.payment_method = COALESCE(t.payment_method, o.payment_method, t.payment_method)
        WHERE t.status = 'COMPLETED';
        `;
        db.query(sql, (err) => (err ? reject(err) : resolve()));
    });
}




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
app.use(express.json());
app.use(methodOverride('_method'));

app.use((req, res, next) => {
    res.setHeader("Permissions-Policy", "interest-cohort=()");
    next();
});

// Stripe init
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY;
const stripe = STRIPE_SECRET_KEY ? stripeSdk(STRIPE_SECRET_KEY) : null;
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

// Helper: build order from cart after successful payment
async function createOrderFromCart(userId, options = {}) {
    const {
        paymentMethod = 'UNKNOWN',
        paymentStatus = 'PENDING',
        paymentRef = null,
        payerEmail = null,
        paidAt = null,
        clearCart = true
    } = options;

    const cart = await new Promise((resolve, reject) => {
        Cart.getCart(userId, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });

    if (!cart.length) throw new Error("Cart empty");

    const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);

    const orderId = await new Promise((resolve, reject) => {
        Order.create(
            userId,
            total,
            { paymentMethod, paymentStatus, paymentRef, payerEmail, paidAt },
            (err, id) => (err ? reject(err) : resolve(id))
        );
    });

    for (const item of cart) {
        await new Promise((resolve, reject) => {
            Order.addItem(
                orderId,
                item.product_id,
                item.productName,
                item.price,
                item.quantity,
                (err) => (err ? reject(err) : resolve())
            );
        });
    }

    if (clearCart) {
        await new Promise((resolve, reject) => {
            Cart.clearCart(userId, (err) => (err ? reject(err) : resolve()));
        });
    }

    return { orderId, cart, total };
}


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
// TEMP: 2FA disabled for testing - re-enable by adding ", ensure2FA" after checkAuthenticated
app.post('/add-to-cart/:id', checkAuthenticated, CartController.add);
app.get('/cart', checkAuthenticated, CartController.view);
app.post('/cart/delete/:id', checkAuthenticated, CartController.delete);
app.post('/cart/update/:id', checkAuthenticated, CartController.updateQuantity);

// CHECKOUT (2FA disabled for testing)
app.get('/checkout', checkAuthenticated, CartController.checkoutPage);
app.post('/checkout/confirm', checkAuthenticated, CartController.confirmOrder);
app.get('/checkout/success', checkAuthenticated, CartController.successPage);


// STRIPE Checkout - create session (2FA disabled for testing)
app.post('/api/stripe/create-session', checkAuthenticated, async (req, res) => {
    try {
        if (!stripe) return res.status(500).json({ error: "Stripe not configured" });

        const userId = req.session.user.id;
        const cart = await new Promise((resolve, reject) => {
            Cart.getCart(userId, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });
        if (!cart.length) return res.status(400).json({ error: "Cart is empty" });

        const line_items = cart.map((item) => ({
            price_data: {
                currency: "sgd",
                product_data: { name: item.productName },
                unit_amount: Math.round(Number(item.price) * 100),
            },
            quantity: Number(item.quantity),
        }));

        const total = cart.reduce(
            (sum, item) => sum + Number(item.price) * Number(item.quantity),
            0
        );

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            // Allow both standard card entry and Stripe Link wallet
            payment_method_types: ["card", "link"],
            line_items,
            success_url: `${req.protocol}://${req.get("host")}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get("host")}/checkout`,
            customer_email: req.session.user.email,
        });

        // keep snapshot so we can rebuild order even if cart is cleared before return
        req.session.stripePending = { sessionId: session.id, total, cartSnapshot: cart };
        res.json({ id: session.id, url: session.url });
    } catch (err) {
        console.error("Stripe create-session error:", err);
        res.status(500).json({ error: err.message });
    }
});

// STRIPE success landing (2FA disabled for testing)
app.get('/stripe/success', checkAuthenticated, async (req, res) => {
    try {
        const { session_id } = req.query;
        console.log("Stripe success called with session_id:", session_id);
        
        if (!stripe || !session_id) {
            console.error("Missing stripe instance or session_id");
            req.flash("error", "Missing Stripe session.");
            return res.redirect("/checkout");
        }

        const session = await stripe.checkout.sessions.retrieve(session_id, {
            expand: ["payment_intent", "customer_details", "line_items"],
        });

        console.log("Stripe session retrieved:", { status: session.payment_status, id: session.id });

        const paymentIntentId =
            typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id;

        // Prevent duplicate orders
        if (req.session.stripeCompleted === session.id) {
            console.log("Stripe order already completed, redirecting to orders");
            return res.redirect("/orders");
        }

        // Only process if payment was successful (fallback to PI status, with short polling for Link/processing cases)
        let paid = session.payment_status === 'paid' || session.status === 'complete';
        if (!paid && session.payment_intent) {
            const waitForPi = async (piId) => {
                for (let i = 0; i < 10; i++) {
                    const pi = await stripe.paymentIntents.retrieve(piId);
                    if (pi?.status === 'succeeded' || pi?.status === 'requires_capture') return true;
                    if (pi?.status === 'processing') {
                        await new Promise((r) => setTimeout(r, 2000));
                        continue;
                    }
                    return false;
                }
                return false;
            };
            try {
                paid = await waitForPi(session.payment_intent);
            } catch (e) {
                console.error("Stripe PI retrieve error:", e?.stack || e);
            }
        }
        if (!paid) {
            req.flash("error", `Payment not completed yet (status: ${session.payment_status || session.status}). If you used Link, please try again.`);
            return res.redirect("/checkout");
        }

        const userId = req.session.user.id;
        let orderId, total;
        try {
            const meta = await createOrderFromCart(userId, {
                paymentMethod: "STRIPE",
                paymentStatus: "PAID",
                paymentRef: paymentIntentId || session.id,
                payerEmail: session.customer_details?.email || req.session.user.email,
                paidAt: new Date(),
            });
            orderId = meta.orderId;
            total = meta.total;
        } catch (cartErr) {
            // fallback: rebuild order from snapshot if cart was emptied
            let snap = req.session.stripePending?.cartSnapshot || [];
            // fallback 2: rebuild from Stripe line items
            if (!snap.length && Array.isArray(session.line_items?.data)) {
                snap = session.line_items.data.map(li => ({
                    product_id: 0, // unknown in Stripe; store as 0
                    productName: li.description || "Stripe Item",
                    price: (li.price?.unit_amount || 0) / 100,
                    quantity: li.quantity || 1,
                }));
            }
            if (!snap.length) {
                console.error("Stripe fallback failed, no cart snapshot or line items", cartErr);
                throw cartErr;
            }

            total = snap.reduce((s, i) => s + Number(i.price) * Number(i.quantity), 0);
            orderId = await new Promise((resolve, reject) => {
                Order.create(
                    userId,
                    total,
                    {
                        paymentMethod: "STRIPE",
                        paymentStatus: "PAID",
                        paymentRef: paymentIntentId || session.id,
                        payerEmail: session.customer_details?.email || req.session.user.email,
                        paidAt: new Date(),
                    },
                    (err2, id) => (err2 ? reject(err2) : resolve(id))
                );
            });
            for (const item of snap) {
                await new Promise((resolve, reject) => {
                    Order.addItem(
                        orderId,
                        item.product_id,
                        item.productName,
                        item.price,
                        item.quantity,
                        (err2) => (err2 ? reject(err2) : resolve())
                    );
                });
            }
        }

        console.log("Order created:", { orderId, total });

        Transaction.create(
            {
                orderId: String(orderId),
                payerId: paymentIntentId || session.id,
                payerEmail: session.customer_details?.email || req.session.user.email,
                amount: total,
                currency: "SGD",
                status: "PAID",
                time: new Date(),
                paymentMethod: "STRIPE",
                paymentRef: paymentIntentId || session.id,
            },
            (txnErr) => {
                if (txnErr) {
                    console.error("Transaction insert error:", txnErr);
                } else {
                    console.log("Transaction recorded for orderId:", orderId);
                }
            }
        );

        req.session.stripeCompleted = session.id;
        req.session.stripePending = null;
        console.log("Redirecting to success page with orderId:", orderId);
        res.redirect("/checkout/success?orderId=" + orderId);
    } catch (err) {
        console.error("Stripe success handling error:", err?.stack || err);
        req.flash("error", "Stripe payment verification failed: " + (err?.message || "Unknown error"));
        res.redirect("/checkout");
    }
});

// NETS QR (Sandbox) - use controller (2FA disabled for testing)
app.post('/api/nets/qr-request', checkAuthenticated, NetsController.requestQr);
app.get('/api/nets/query', checkAuthenticated, NetsController.queryStatus);

// PAYPAL (CA2) - CREATE ORDER (2FA disabled for testing)
app.post('/api/paypal/create-order', checkAuthenticated, async (req, res) => {
    try {
        const { amount } = req.body;
        if (!amount) return res.status(400).json({ error: "Amount is required" });

        const ppOrder = await paypal.createOrder(amount);

        // create pending order, keep cart intact for now
        const pending = await createOrderFromCart(req.session.user.id, {
            paymentMethod: 'PAYPAL',
            paymentStatus: 'PENDING',
            paymentRef: ppOrder.id,
            payerEmail: req.session.user.email,
            clearCart: false
        });
        req.session.paypalPendingOrderId = pending.orderId;

        return res.json({ id: ppOrder.id });
    } catch (err) {
        console.error("create-order error:", err);
        return res.status(500).json({ error: err.message });
    }
});

// PAYPAL (CA2) - CAPTURE ORDER (2FA disabled for testing)
app.post('/api/paypal/capture-order', checkAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { orderID } = req.body;

        const capture = await paypal.captureOrder(orderID);
        const cap = capture?.purchase_units?.[0]?.payments?.captures?.[0];
        const captureId = cap?.id;
        const payerEmail = capture?.payer?.email_address || req.session.user.email;

        // Primary: get pending order from session
        let orderId = req.session.paypalPendingOrderId;

        // Fallback: locate a pending order by payment_ref if session was lost/refreshed
        if (!orderId) {
            const fallback = await new Promise((resolve, reject) =>
                db.query(
                    `SELECT id FROM orders 
                     WHERE user_id=? AND payment_ref=? AND payment_status='PENDING'
                     ORDER BY order_date DESC LIMIT 1`,
                    [userId, orderID],
                    (err, rows) => (err ? reject(err) : resolve(rows && rows[0] && rows[0].id))
                )
            ).catch(() => null);
            orderId = fallback;
        }

        if (!orderId) {
            return res.status(400).json({ error: "No pending order found for this payment" });
        }

        await new Promise((resolve, reject) =>
            db.query(
                `UPDATE orders 
                 SET payment_status='PAID', payment_method='PAYPAL', payment_ref=?, payer_email=?, paid_at=NOW()
                 WHERE id=?`,
                [orderID, payerEmail, orderId],
                (err) => (err ? reject(err) : resolve())
            )
        );

        await new Promise((resolve, reject) =>
            Cart.clearCart(userId, (err) => (err ? reject(err) : resolve()))
        );

        Transaction.create(
            {
                orderId: String(orderId),
                payerId: capture?.payer?.payer_id || "UNKNOWN",
                payerEmail,
                amount: cap?.amount?.value || "0.00",
                currency: cap?.amount?.currency_code || "SGD",
                status: cap?.status || capture?.status || "COMPLETED",
                time: new Date(),
                paymentMethod: 'PAYPAL',
                paymentRef: orderID,
                captureId
            },
            (txnErr) => txnErr && console.error("Transaction insert error:", txnErr)
        );

        // cleanup: once paid, drop pending flag in session
        req.session.paypalPendingOrderId = null;

        return res.json({ success: true, orderId });
    } catch (err) {
        console.error("capture-order error:", err);
        return res.status(500).json({ error: err.message });
    }
});


// ORDERS + INVOICE
app.get('/orders', checkAuthenticated, ensure2FA, OrderController.list);
app.get('/invoice/:id', checkAuthenticated, ensure2FA, InvoiceController.download);

// ADMIN — View ALL customer orders
app.get('/admin/orders', checkAuthenticated, ensure2FA, checkAdmin, OrderController.adminList);

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    try {
        await reconcilePayments();
        console.log("Reconciliation complete");
    } catch (err) {
        console.error("Reconciliation error:", err);
    }
    console.log("Server running at http://localhost:" + PORT);
});
