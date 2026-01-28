# NETS QR Payment Testing Guide

## Prerequisites
1. ✅ You have a NETS sandbox account
2. ✅ You have API_KEY and PROJECT_ID in your `.env` file
3. ✅ You have the NETS mobile app installed on your phone (for testing)
4. ✅ Server is running on `http://localhost:3000`

## Step-by-Step Testing

### 1. Start the Server
```bash
cd SupermarketAppMVC
npm start
# Or: node app.js
# Or: nodemon app.js (if you want auto-reload)
```
You should see: `Server running at http://localhost:3000`

### 2. Register & Login
- Go to `http://localhost:3000/register`
- Create a test account
- Login to the account

### 3. Add Items to Cart
- Go to `http://localhost:3000/shopping`
- Add items to your cart
- Go to `http://localhost:3000/cart` to verify

### 4. Proceed to Checkout
- Click "Checkout" or go to `http://localhost:3000/checkout`
- You should see three payment options:
  - Pay with NETS QR (with NETS logo)
  - Pay with Card (Stripe)
  - Pay with PayPal

### 5. Test NETS QR Payment

#### Option A: Browser Console Testing
```javascript
// Open browser DevTools (F12) → Console tab

// Simulate QR request
fetch('/api/nets/qr-request', {
    method: 'POST',
    headers: { 'accept': 'application/json' }
})
.then(r => r.json())
.then(d => {
    console.log('QR Response:', d);
    console.log('QR Image URL:', d.qrDataUrl);
    console.log('Transaction Ref:', d.txn_retrieval_ref);
})
.catch(e => console.error('Error:', e));
```

#### Option B: Click the Button
1. **Click "Pay with NETS QR" button**
   - Status should change to "Requesting NETS QR..."
   - If successful: QR code image appears
   - If error: See error message in red

2. **Scan the QR Code**
   - Use your phone with NETS app
   - Scan the displayed QR code
   - Complete payment in app

3. **Watch the Polling**
   - Frontend polls every 3 seconds
   - Check Network tab → XHR/Fetch filters
   - Watch `/api/nets/query` requests

4. **Payment Success**
   - After successful payment
   - System redirects to success page
   - Cart is cleared
   - Order is created in database

## Expected Network Requests

### 1. QR Generation Request
```
POST /api/nets/qr-request
Headers:
  - accept: application/json

Response:
{
  "qrDataUrl": "data:image/png;base64,iVBOR...",
  "txn_retrieval_ref": "012345678901234567890",
  ...
}
```

### 2. Status Poll Requests (repeating every 3 seconds)
```
GET /api/nets/query?txn_retrieval_ref=012345678901234567890

Response (pending):
{
  "status": "pending",
  "txn_status": 1,
  "response_code": "00"
}

Response (success):
{
  "status": "paid",
  "orderId": 123
}

Response (failed):
{
  "status": "failed",
  "message": "NETS payment failed or was cancelled",
  "response_code": "00"
}
```

## Checking Results

### View Order Created
1. Go to `http://localhost:3000/orders`
2. Find your newly created order
3. Check payment method = "NETS"
4. Check payment status = "PAID"

### View Database Records

#### Check orders table
```sql
SELECT * FROM orders WHERE payment_method = 'NETS' ORDER BY order_date DESC LIMIT 1;
```

#### Check transactions table
```sql
SELECT * FROM transactions WHERE payment_method = 'NETS' ORDER BY time DESC LIMIT 1;
```

#### Check order_items
```sql
SELECT * FROM order_items WHERE order_id = [your_order_id];
```

## Troubleshooting

### Issue: "Unable to create NETS QR" Error

**Check:**
1. Is `.env` configured correctly?
   ```bash
   echo $env:API_KEY
   echo $env:PROJECT_ID
   ```
   
2. Are the values correct in `.env`?
   ```
   API_KEY=your_actual_key_here
   PROJECT_ID=your_actual_project_here
   ```

3. Check server console for detailed error:
   ```
   NETS requestQr error: [error details]
   ```

### Issue: QR Generated but Payment Not Confirming

**Check:**
1. Is NETS app actually processing payment?
   - Check NETS app on phone for status
   - Check transaction history in NETS dashboard

2. Are polling requests being made?
   - Open DevTools → Network tab
   - Watch for `/api/nets/query` requests
   - Check response codes

3. Is session staying active?
   - Check browser cookies
   - Session might be expiring

### Issue: "Resource Not Found" on Checkout Page

**Possible Causes:**
1. Missing checkout.ejs view file
2. Missing partial footer/header files
3. PayPal/Stripe variables not passed

**Fix:**
- Verify all files exist:
  - `views/checkout.ejs`
  - `views/partials/header.ejs`
  - `views/partials/footer.ejs`

### Issue: Server Won't Start

**Check:**
1. Port 3000 is not in use:
   ```bash
   netstat -ano | findstr :3000
   ```

2. Dependencies installed:
   ```bash
   npm install
   npm list axios
   ```

3. .env file exists and has valid values

## Success Indicators

✅ **You'll know it's working when:**
1. QR code appears when button is clicked
2. Network shows `/api/nets/query` requests repeating
3. After payment on phone, page redirects to success
4. Order appears in `/orders` page
5. Cart is empty after payment
6. Database has new transaction record

## Common NETS Response Codes

| Code | Meaning |
|------|---------|
| 00   | Success |
| 01   | Invalid Request |
| 08   | Transaction Declined |
| 12   | Invalid Transaction Type |
| 39   | Accumulator Overflow |
| 91   | Issuer or Switch Unavailable |

## Need Help?

1. **Check Server Console**
   - Look for "NETS..." log messages
   - Errors prefixed with "NETS query error:"

2. **Check Browser Console** (F12)
   - JavaScript errors
   - Network request details

3. **Check Network Tab** (F12 → Network)
   - Request/response bodies
   - Status codes (should be 200 for success)

4. **Check Database**
   - Run SQL queries above
   - Verify orders/transactions created

5. **Review logs**
   - Check NETS sandbox dashboard
   - Verify transaction was received
