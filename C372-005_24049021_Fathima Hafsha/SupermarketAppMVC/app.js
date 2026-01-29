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
const SubscriptionController = require('./controllers/subscriptionController');
const RefundController = require('./controllers/refundController');
const Product = require('./models/Product');
const paypal = require('./services/paypal');
const { computeTotalWithBenefits } = require('./services/benefits');
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
// Preserve raw body for Stripe webhook signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        if (req.originalUrl === '/webhook/stripe') {
            req.rawBody = buf.toString();
        }
    }
}));
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
    // Demo bypass: comment this block back in to re-enable enforcement
    // if (!req.session.user) return res.redirect("/login");
    // if (!req.session.user.twofa_enabled) {
    //     req.flash("error", "Please enable 2FA first.");
    //     return res.redirect("/2fa/setup");
    // }
    return next();
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
        clearCart = true,
        forceTotal = null
    } = options;

    const cart = await new Promise((resolve, reject) => {
        Cart.getCart(userId, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });

    if (!cart.length) throw new Error("Cart empty");

    const computed = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    const total = forceTotal !== null ? forceTotal : computed;

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

// Helper: find latest order by payment_ref (used for Stripe/PayPal webhooks & fallbacks)
async function findOrderByPaymentRef(paymentRef) {
    if (!paymentRef) return null;
    return new Promise((resolve, reject) => {
        db.query(
            `SELECT id, user_id, total_amount, payment_status 
             FROM orders WHERE payment_ref = ? 
             ORDER BY order_date DESC LIMIT 1`,
            [paymentRef],
            (err, rows) => (err ? reject(err) : resolve(rows?.[0] || null))
        );
    });
}

// Helper: update an order's payment status/details in one place
async function markOrderPayment(orderId, { status, method = 'UNKNOWN', ref, payerEmail, paidAt = new Date() }) {
    return new Promise((resolve, reject) => {
        db.query(
            `UPDATE orders 
             SET payment_status=?, payment_method=?, payment_ref=COALESCE(?, payment_ref), payer_email=COALESCE(?, payer_email), paid_at=IFNULL(paid_at, ?), delivery_status=IFNULL(delivery_status,'PREPARING')
             WHERE id=?`,
            [status, method, ref || null, payerEmail || null, paidAt, orderId],
            (err) => (err ? reject(err) : resolve())
        );
    });
}

// Helper: record transaction row (best-effort; ignore duplicate failures)
async function recordTransactionSafe(data) {
    return new Promise((resolve) => {
        Transaction.create(data, (err) => {
            if (err) console.error("Transaction insert error:", err);
            resolve();
        });
    });
}

// Helper: store delivery / promo extras (best-effort, ignore if columns not present)
async function updateOrderExtras(orderId, extras = {}) {
    if (!orderId) return;
    const {
        deliveryType = null,
        scheduledAt = null,
        etaMin = null,
        etaMax = null,
        promoCode = null,
        promoDiscount = null
    } = extras;
    const sql = `
        UPDATE orders SET 
            delivery_type = COALESCE(?, delivery_type),
            scheduledAt = COALESCE(?, scheduledAt),
            eta_min = COALESCE(?, eta_min),
            eta_max = COALESCE(?, eta_max),
            promoCode = COALESCE(?, promoCode),
            promoDiscount = COALESCE(?, promoDiscount)
        WHERE id = ?`;
    return new Promise((resolve) => {
        db.query(sql, [deliveryType, scheduledAt, etaMin, etaMax, promoCode, promoDiscount, orderId], (err) => {
            if (err) console.warn("updateOrderExtras warning (ignore if column missing):", err.message);
            resolve();
        });
    });
}

// Helper: sync payment intent updates (Stripe success/fail)
async function syncStripePaymentIntent(pi, desiredStatus = "PAID") {
    if (!pi || !pi.id) return;
    const paymentRef = pi.id;
    const payerEmail =
        pi.charges?.data?.[0]?.billing_details?.email ||
        pi.receipt_email ||
        null;
    const amount =
        (pi.amount_received || pi.amount || 0) / 100;
    const currency = (pi.currency || "sgd").toUpperCase();

    const order = await findOrderByPaymentRef(paymentRef);
    if (!order) return;

    await markOrderPayment(order.id, {
        status: desiredStatus,
        method: "STRIPE",
        ref: paymentRef,
        payerEmail,
        paidAt: new Date()
    });

    if (desiredStatus === "PAID" && order.user_id) {
        await new Promise((resolve) => Cart.clearCart(order.user_id, () => resolve()));
    }

    await recordTransactionSafe({
        orderId: String(order.id),
        payerId: paymentRef,
        payerEmail,
        amount,
        currency,
        status: desiredStatus,
        time: new Date(),
        paymentMethod: "STRIPE",
        paymentRef
    });
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
        const { deliveryType = "NOW", scheduledAt = null, promoCode = "" } = req.body || {};
        const Delivery = require("./services/deliveryService");
        const Promo = require("./services/promoService");

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

        const benefits = await computeTotalWithBenefits(userId, cart);
        const promo = Promo.applyPromo(promoCode, benefits.base);
        const promoDiscount = promo.applied ? promo.discount : 0;
        const total = Math.max(0.5, benefits.base + benefits.deliveryFee - benefits.discount - promoDiscount);

        if (deliveryType === "SCHEDULED") {
            const check = Delivery.validateSchedule(scheduledAt);
            if (!check.valid) return res.status(400).json({ error: check.message });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            // Allow both standard card entry and Stripe Link wallet
            payment_method_types: ["card", "link"],
            line_items,
            metadata: { userId: String(userId), deliveryType, scheduledAt: scheduledAt || "", promoCode: promoCode || "" },
            payment_intent_data: {
                metadata: { userId: String(userId), deliveryType, scheduledAt: scheduledAt || "", promoCode: promoCode || "" }
            },
            success_url: `${req.protocol}://${req.get("host")}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get("host")}/checkout`,
            customer_email: req.session.user.email,
        });

        const paymentIntentId =
            typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id;

        // Create or reuse a pending order tied to this payment intent
        let pendingOrderId = null;
        try {
            const existing = await findOrderByPaymentRef(paymentIntentId || session.id);
            if (existing) {
                pendingOrderId = existing.id;
            } else {
                const pending = await createOrderFromCart(userId, {
                    paymentMethod: "STRIPE",
                    paymentStatus: "PENDING",
                    paymentRef: paymentIntentId || session.id,
                    payerEmail: req.session.user.email,
                    clearCart: false, // keep cart intact until payment is confirmed
                    forceTotal: total
                });
                pendingOrderId = pending.orderId;
                await updateOrderExtras(pendingOrderId, {
                    deliveryType,
                    scheduledAt: deliveryType === "SCHEDULED" ? scheduledAt : null,
                    etaMin: Delivery.computeETA({ deliveryType, scheduledAt, total }).etaMinMinutes || null,
                    etaMax: Delivery.computeETA({ deliveryType, scheduledAt, total }).etaMaxMinutes || null,
                    promoCode: promoCode || null,
                    promoDiscount
                });
            }
        } catch (orderErr) {
            console.error("Unable to create pending Stripe order:", orderErr);
        }

        // keep snapshot so we can rebuild order even if cart is cleared before return
        req.session.stripePending = {
            sessionId: session.id,
            total,
            cartSnapshot: cart,
            orderId: pendingOrderId,
            paymentIntentId: paymentIntentId || null,
            deliveryType,
            scheduledAt,
            promoCode,
            promoDiscount
        };
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
        const payerEmail = session.customer_details?.email || req.session.user.email;
        const paymentRef = paymentIntentId || session.id;
        let orderId, total;

        const existing = await findOrderByPaymentRef(paymentRef);
        if (existing) {
            orderId = existing.id;
            total = Number(existing.total_amount) || 0;
            await markOrderPayment(orderId, {
                status: "PAID",
                method: "STRIPE",
                ref: paymentRef,
                payerEmail,
                paidAt: new Date(),
            });
            await updateOrderExtras(orderId, {
                deliveryType: existing.delivery_type || null,
                scheduledAt: existing.scheduledAt || null
            });
            await new Promise((resolve) => Cart.clearCart(userId, () => resolve()));
        } else {
            try {
                const meta = await createOrderFromCart(userId, {
                    paymentMethod: "STRIPE",
                    paymentStatus: "PAID",
                    paymentRef,
                    payerEmail,
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
                            paymentRef,
                            payerEmail,
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

            await updateOrderExtras(orderId, {
                deliveryType: req.session.stripePending?.deliveryType || "NOW",
                scheduledAt: req.session.stripePending?.scheduledAt || null,
                promoCode: req.session.stripePending?.promoCode || null,
                promoDiscount: req.session.stripePending?.promoDiscount || null
            });
        }

        console.log("Order recorded:", { orderId, total });

        if (!total && session.amount_total) {
            total = session.amount_total / 100;
        }

        await recordTransactionSafe({
            orderId: String(orderId),
            payerId: paymentRef,
            payerEmail,
            amount: total,
            currency: "SGD",
            status: "PAID",
            time: new Date(),
            paymentMethod: "STRIPE",
            paymentRef
        });

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

// STRIPE webhook (reliable payment status updates)
app.post('/webhook/stripe', async (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
        return res.status(400).send("Stripe webhook not configured");
    }
    if (!req.rawBody) {
        return res.status(400).send("Stripe webhook raw body missing");
    }

    const sig = req.headers["stripe-signature"];
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.rawBody,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error("Stripe webhook signature failed:", err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === "payment_intent.succeeded") {
            await syncStripePaymentIntent(event.data.object, "PAID");
        } else if (event.type === "payment_intent.payment_failed") {
            await syncStripePaymentIntent(event.data.object, "FAILED");
        }
    } catch (err) {
        console.error("Stripe webhook handling error:", err);
    }

    res.json({ received: true });
});

// NETS QR (Sandbox) - use controller (2FA disabled for testing)
app.post('/api/nets/qr-request', checkAuthenticated, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { deliveryType = "NOW", scheduledAt = null, promoCode = "" } = req.body || {};
        const Delivery = require("./services/deliveryService");
        const Promo = require("./services/promoService");
        const cart = await new Promise((resolve, reject) => {
            Cart.getCart(userId, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });

        if (!cart.length) {
            return res.status(400).json({ error: "Cart is empty" });
        }

        const benefits = await computeTotalWithBenefits(userId, cart);
        const promo = Promo.applyPromo(promoCode, benefits.base);
        const promoDiscount = promo.applied ? promo.discount : 0;
        const cartTotal = Math.max(0.5, benefits.base + benefits.deliveryFee - benefits.discount - promoDiscount);
        if (deliveryType === "SCHEDULED") {
            const check = Delivery.validateSchedule(scheduledAt);
            if (!check.valid) return res.status(400).json({ error: check.message });
        }
        
        console.log("POST /api/nets/qr-request - Cart total:", cartTotal);

        // Call the old generateQrCode logic with cartTotal
        const netsService = require('./services/nets');
        // Use fixed txnId like the working demo - merchant account may be tied to this ID
        const txnId = 'sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b';

        console.log("Requesting QR with txnId:", txnId, "amount:", cartTotal);

        const qrResult = await netsService.requestQr({
            txnId,
            amount: Math.max(1, Math.round(cartTotal)),
            notifyMobile: 0,
        });

        console.log("QR generated successfully:", {
            txnRef: qrResult.txnRetrievalRef,
            hasQrData: !!qrResult.qrDataUrl,
        });

        // Store in session for later reference
        req.session.netsPending = {
            txnId,
            txnRetrievalRef: qrResult.txnRetrievalRef,
            amount: cartTotal,
            userId,
            deliveryType,
            scheduledAt,
            promoCode,
            promoDiscount
        };

        // Return in format expected by checkout.ejs
        return res.json({
            qrDataUrl: qrResult.qrDataUrl,
            txn_retrieval_ref: qrResult.txnRetrievalRef,
        });

    } catch (err) {
        console.error("POST /api/nets/qr-request error:", {
            message: err.message,
            stack: err.stack,
        });
        return res.status(500).json({ 
            error: err.message || "Failed to generate QR code" 
        });
    }
});

app.get('/api/nets/query', checkAuthenticated, async (req, res) => {
    const { txn_retrieval_ref } = req.query;
    
    if (!txn_retrieval_ref) {
        return res.status(400).json({ error: "txn_retrieval_ref is required" });
    }

    try {
        const netsService = require('./services/nets');
        const statusData = await netsService.queryTransaction(txn_retrieval_ref);
        
        const txnStatus = Number(statusData.txnStatus);
        const responseCode = statusData.responseCode;

        console.log("GET /api/nets/query - Status:", { txnStatus, responseCode });

        // txn_status == 1 means payment successful (sandbox returns 1, not 2)
        if (txnStatus === 1) {
            const pending = req.session.netsPending;
            if (!pending || pending.txnRetrievalRef !== txn_retrieval_ref) {
                return res.status(400).json({ error: "No pending NETS session for this transaction" });
            }

            // If already completed in session, return existing orderId
            if (pending.completed && pending.orderId) {
                return res.json({ status: "paid", orderId: pending.orderId });
            }

            // Create order from cart
            const userId = pending.userId || req.session.user.id;
            const cart = await new Promise((resolve, reject) => {
                Cart.getCart(userId, (err, rows) => (err ? reject(err) : resolve(rows || [])));
            });

            if (!cart.length) {
                return res.status(400).json({ error: "Cart is empty, cannot create order" });
            }

            const total = cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);

            const orderId = await new Promise((resolve, reject) => {
                Order.create(
                    userId,
                    total,
                    {
                        paymentMethod: "NETS",
                        paymentStatus: "PAID",
                        paymentRef: txn_retrieval_ref,
                        payerEmail: "NETS",
                        paidAt: new Date(),
                    },
                    (err, id) => (err ? reject(err) : resolve(id))
                );
            });

            // Add items to order
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

            // Clear cart
            await new Promise((resolve, reject) => {
                Cart.clearCart(userId, (err) => (err ? reject(err) : resolve()));
            });

            // Record transaction
            Transaction.create(
                {
                    orderId: String(orderId),
                    payerId: pending.txnId,
                    payerEmail: "NETS",
                    amount: total,
                    currency: "SGD",
                    status: `NETS_${txnStatus}`,
                    time: new Date(),
                    paymentMethod: "NETS",
                    paymentRef: txn_retrieval_ref,
                },
                (txnErr) => txnErr && console.error("Transaction insert error:", txnErr)
            );

            req.session.netsPending = { ...pending, completed: true, orderId };

            console.log("Order created successfully:", orderId);
            return res.json({ status: "paid", orderId });
        }

        // txn_status == 3 means payment failed or cancelled
        if (txnStatus === 3) {
            return res.json({
                status: "failed",
                message: "NETS payment failed or was cancelled",
                response_code: responseCode,
            });
        }

        // Any other status is pending
        return res.json({
            status: "pending",
            txn_status: txnStatus,
            response_code: responseCode,
        });

    } catch (err) {
        console.error("GET /api/nets/query error:", {
            message: err.message,
            stack: err.stack,
        });
        return res.status(500).json({ 
            error: err.message || "NETS query failed" 
        });
    }
});

// PAYPAL (CA2) - CREATE ORDER (2FA disabled for testing)
app.post('/api/paypal/create-order', checkAuthenticated, async (req, res) => {
    try {
        let { amount, deliveryType = "NOW", scheduledAt = null, promoCode = "" } = req.body || {};

        const userId = req.session.user.id;
        const cart = await new Promise((resolve, reject) => {
            Cart.getCart(userId, (err, rows) => (err ? reject(err) : resolve(rows || [])));
        });

        const benefits = await computeTotalWithBenefits(userId, cart);
        const Delivery = require("./services/deliveryService");
        const Promo = require("./services/promoService");
        const promo = Promo.applyPromo(promoCode, benefits.base);
        const promoDiscount = promo.applied ? promo.discount : 0;
        amount = Math.max(0.5, benefits.base + benefits.deliveryFee - benefits.discount - promoDiscount).toFixed(2);

        if (deliveryType === "SCHEDULED") {
            const check = Delivery.validateSchedule(scheduledAt);
            if (!check.valid) return res.status(400).json({ error: check.message });
        }

        const ppOrder = await paypal.createOrder(amount);

        // create pending order, keep cart intact for now
        const pending = await createOrderFromCart(req.session.user.id, {
            paymentMethod: 'PAYPAL',
            paymentStatus: 'PENDING',
            paymentRef: ppOrder.id,
            payerEmail: req.session.user.email,
            clearCart: false,
            forceTotal: Number(amount)
        });
        req.session.paypalPendingOrderId = pending.orderId;
        req.session.paypalBenefits = benefits;
        await updateOrderExtras(pending.orderId, {
            deliveryType,
            scheduledAt: deliveryType === "SCHEDULED" ? scheduledAt : null,
            etaMin: Delivery.computeETA({ deliveryType, scheduledAt, total: amount }).etaMinMinutes || null,
            etaMax: Delivery.computeETA({ deliveryType, scheduledAt, total: amount }).etaMaxMinutes || null,
            promoCode: promoCode || null,
            promoDiscount
        });

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
app.get('/refunds', checkAuthenticated, ensure2FA, OrderController.refundsPage);
app.get('/order/:id', checkAuthenticated, ensure2FA, OrderController.detail);
app.get('/transactions', checkAuthenticated, ensure2FA, OrderController.transactions);
app.get('/subscription', checkAuthenticated, ensure2FA, SubscriptionController.view);
app.post('/subscription/subscribe', checkAuthenticated, ensure2FA, SubscriptionController.subscribe);
app.post('/subscription/cancel', checkAuthenticated, ensure2FA, SubscriptionController.cancel);
app.post('/api/subscription/paypal/create-order', checkAuthenticated, ensure2FA, SubscriptionController.createPaypalOrder);
app.post('/api/subscription/paypal/capture-order', checkAuthenticated, ensure2FA, SubscriptionController.capturePaypalOrder);
app.get('/invoice/:id', checkAuthenticated, ensure2FA, InvoiceController.download);

// ADMIN — View ALL customer orders
app.get('/admin/orders', checkAuthenticated, ensure2FA, checkAdmin, OrderController.adminList);
app.get('/admin/subscriptions', checkAuthenticated, ensure2FA, checkAdmin, SubscriptionController.adminList);
app.post('/admin/refund/stripe/:id', checkAuthenticated, ensure2FA, checkAdmin, RefundController.stripe);
app.post('/admin/refund/paypal/:id', checkAuthenticated, ensure2FA, checkAdmin, RefundController.paypal);
app.post('/admin/refund/reject/:id', checkAuthenticated, ensure2FA, checkAdmin, RefundController.reject);
app.post('/admin/refund/process/:id', checkAuthenticated, ensure2FA, checkAdmin, RefundController.processManual);
app.post('/refund/request/:id', checkAuthenticated, RefundController.request);

// START SERVER
const PORT = process.env.PORT || 8080;
app.listen(PORT, async () => {
    try {
        await reconcilePayments();
        console.log("Reconciliation complete");
    } catch (err) {
        console.error("Reconciliation error:", err);
    }
    console.log("Server running at http://localhost:" + PORT);
});
app.get('/api/orders/:id/tracking', checkAuthenticated, async (req, res) => {
    const orderId = req.params.id;
    const Delivery = require('./services/deliveryService');
    try {
        const order = await new Promise((resolve, reject) => {
            db.query('SELECT * FROM orders WHERE id=?', [orderId], (err, rows) => err ? reject(err) : resolve(rows?.[0]));
        });
        if (!order) return res.status(404).json({ error: 'Not found' });
        if (req.session.user.role !== 'admin' && Number(order.user_id) !== Number(req.session.user.id)) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        const etaText = order.delivery_type === 'SCHEDULED' && order.scheduledAt
            ? Delivery.computeETA({ deliveryType: 'SCHEDULED', scheduledAt: order.scheduledAt })?.etaText
            : Delivery.computeETA({ deliveryType: 'NOW', total: order.total_amount, scheduledAt: null })?.etaText;
        res.json({
            status: order.delivery_status || 'PREPARING',
            updatedAt: order.deliveryUpdatedAt || order.order_date,
            etaText
        });
    } catch (err) {
        console.error('tracking error', err);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/admin/orders/:id/delivery-status', checkAuthenticated, ensure2FA, checkAdmin, (req, res) => {
    const orderId = req.params.id;
    const { status } = req.body || {};
    const allowed = ['PREPARING','OUT_FOR_DELIVERY','DELIVERED'];
    if (!allowed.includes(status)) {
        req.flash('error', 'Invalid status');
        return res.redirect('/admin/orders');
    }
    db.query(
        `UPDATE orders SET delivery_status=?, deliveryUpdatedAt=NOW() WHERE id=?`,
        [status, orderId],
        (err) => {
            if (err) {
                console.error('update delivery status error', err);
                req.flash('error', 'Failed to update');
            } else {
                req.flash('success', 'Delivery status updated');
            }
            res.redirect('/admin/orders');
        }
    );
});
