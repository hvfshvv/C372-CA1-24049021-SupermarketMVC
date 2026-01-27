const fetch = require('node-fetch');
require('dotenv').config();

const PAYPAL_CLIENT = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const PAYPAL_API = process.env.PAYPAL_API;

async function getAccessToken() {
    const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
            'Authorization': 'Basic ' + Buffer.from(PAYPAL_CLIENT + ':' + PAYPAL_SECRET).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });
    let data;
    try {
        data = await response.json();
    } catch (err) {
        const text = await response.text();
        console.error("PayPal token non-JSON response:", text);
        throw new Error("PayPal token request returned non-JSON response");
    }
    if (!response.ok) {
        throw new Error(data.error_description || data.error || "Failed to get PayPal token");
    }
    return data.access_token;
}

async function createOrder(amount) {
    const accessToken = await getAccessToken();
    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
            intent: 'CAPTURE',
            purchase_units: [{
                amount: {
                    currency_code: 'SGD',
                    value: amount
                }
            }]
        })
    });
    let data;
    try {
        data = await response.json();
    } catch (err) {
        const text = await response.text();
        console.error("PayPal create order non-JSON response:", text);
        throw new Error("PayPal create order returned non-JSON response");
    }
    if (!response.ok) {
        console.error("PayPal create order failed:", data);
        throw new Error(data.message || "Failed to create PayPal order");
    }
    return data;
}

async function captureOrder(orderId) {
    const accessToken = await getAccessToken();
    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        }
    });
    let data;
    try {
        data = await response.json();
    } catch (err) {
        const text = await response.text();
        console.error("PayPal capture non-JSON response:", text);
        throw new Error("PayPal capture returned non-JSON response");
    }
    console.log('PayPal captureOrder response:', data);
    if (!response.ok) {
        throw new Error(data.message || "Failed to capture PayPal order");
    }
    return data;
}
async function refundCapture(captureId) {
    const accessToken = await getAccessToken();
    const response = await fetch(`${PAYPAL_API}/v2/payments/captures/${captureId}/refund`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({})
    });
    const data = await response.json().catch(async () => { throw new Error(await response.text()); });
    if (!response.ok) throw new Error(data.message || "PayPal refund failed");
    return data;
}


module.exports = { createOrder, captureOrder, refundCapture };