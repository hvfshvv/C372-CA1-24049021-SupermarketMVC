const PDFDocument = require("pdfkit");
const Order = require("../models/Order");

const InvoiceController = {
    download: (req, res) => {
        const orderId = req.params.id;
        const user = req.session.user;

        // Get items
        Order.getItems(orderId, (err, items) => {
            if (err || !items.length) {
                return res.status(404).send("Invoice not found");
            }

            // Get order header
            Order.getById(orderId, (err2, order) => {
                if (err2 || !order) {
                    return res.status(404).send("Order not found");
                }

                // Security: only admin
                if (order.user_id !== user.id && user.role !== "admin") {
                    return res.status(403).send("Access denied");
                }

                const doc = new PDFDocument({ margin: 50 });
                res.setHeader("Content-Type", "application/pdf");
                res.setHeader(
                    "Content-Disposition",
                    `attachment; filename=invoice-${orderId}.pdf`
                );

                doc.pipe(res);

                // ---------- Header ----------
                doc
                    .fontSize(20)
                    .text("SupermarketAppMVC", { align: "center" })
                    .moveDown(0.3);

                doc
                    .fontSize(10)
                    .text("123 RP Campus Road, Singapore 739123", { align: "center" })
                    .text("Email: support@supermarketmvc.com", { align: "center" })
                    .text("Phone: +65 6123 4567", { align: "center" })
                    .moveDown(0.8);

                doc
                    .moveTo(50, doc.y)
                    .lineTo(550, doc.y)
                    .stroke()
                    .moveDown(0.8);

                doc
                    .fontSize(16)
                    .text("Purchase Receipt", { align: "center" })
                    .moveDown();

                // ---------- Order info ----------
                doc.fontSize(12);
                doc.text(`Invoice No: INV-${orderId}`);
                doc.text(`Order ID: ${orderId}`);
                doc.text(`Customer: ${user.username} (${user.email})`);
                doc.text(`Date: ${order.order_date}`);
                doc.text(`Payment Method: ${order.payment_method || "UNKNOWN"}`);
                doc.text(`Payment Status: ${order.payment_status || "PENDING"}`);
                doc.text(`Payment Ref: ${order.payment_ref || "N/A"}`);
                doc.text(`Payer Email: ${order.payer_email || user.email || "N/A"}`);
                if (order.paid_at) doc.text(`Paid At: ${order.paid_at}`);
                doc.moveDown();

                doc.text("----------------------------------------");
                doc.moveDown(0.5);

                // ---------- Items ----------
                items.forEach((i) => {
                    const price = Number(i.price) || 0;
                    const lineTotal = price * i.quantity;

                    doc.text(
                        `${i.product_name} (x${i.quantity})  —  $${price.toFixed(2)}  |  Line: $${lineTotal.toFixed(2)}`
                    );
                });

                doc.moveDown();
                doc.text("----------------------------------------");

                // ---------- Total ----------
                const total = Number(order.total_amount) || 0;
                doc.moveDown(0.5);
                doc
                    .fontSize(14)
                    .text(`Total: $${total.toFixed(2)}`, { align: "right" });

                doc.moveDown(1.5);
                doc.fontSize(10).text("Thank you for shopping with SupermarketAppMVC!", {
                    align: "center",
                });
                if (order.payment_status && order.payment_status.toUpperCase().includes("REFUND")) {
                    doc.moveDown(0.5);
                    doc.text(`Refund Status: ${order.payment_status}`);
                    if (order.payment_ref) doc.text(`Refund Ref: ${order.payment_ref}`);
                }

                doc.end();
            });
        });
    }
};

module.exports = InvoiceController;
