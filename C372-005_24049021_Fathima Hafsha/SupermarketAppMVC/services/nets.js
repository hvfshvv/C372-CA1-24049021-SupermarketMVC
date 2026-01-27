// const fetch = require("node-fetch");
// const QRCode = require("qrcode");
// require("dotenv").config();

// const NETS_BASE_URL =
//     process.env.NETS_BASE_URL || "https://sandbox.nets.openapipaas.com";

// function getCreds() {
//     const apiKey = process.env.NETS_API_KEY || process.env.API_KEY;
//     const projectId = process.env.NETS_PROJECT_ID || process.env.PROJECT_ID;
//     return { apiKey, projectId };
// }

// function ensureCreds() {
//     const { apiKey, projectId } = getCreds();
//     if (!apiKey || !projectId) {
//         const missing = [];
//         if (!apiKey) missing.push("NETS_API_KEY (or API_KEY)");
//         if (!projectId) missing.push("NETS_PROJECT_ID (or PROJECT_ID)");
//         throw new Error("NETS credentials missing: " + missing.join(", "));
//     }
// }

// function buildHeaders() {
//     const { apiKey, projectId } = getCreds();
//     return {
//         "Content-Type": "application/json",
//         "api-key": String(apiKey),
//         "project-id": String(projectId),
//     };
// }

// async function requestQr({ txnId, amount, notifyMobile = 0 }) {
//     ensureCreds();

//     const amountNumber = Number(amount);
//     const normalizedAmount = Number.isFinite(amountNumber)
//         ? amountNumber.toFixed(2)
//         : "0.00";

//     const body = {
//         txn_id: txnId,
//         amt_in_dollars: normalizedAmount,
//         notify_mobile: notifyMobile,

//         tid_nets: "",
//         mid_nets: "",
//     };

//     const response = await fetch(
//         `${NETS_BASE_URL}/api/v1/common/payments/nets-qr/request`,
//         {
//             method: "POST",
//             headers: buildHeaders(),
//             body: JSON.stringify(body),
//         }
//     );

//     let json;
//     try {
//         json = await response.json();
//     } catch (err) {
//         const text = await response.text();
//         console.error("NETS QR request non-JSON response:", text);
//         throw new Error("NETS QR request returned non-JSON response");
//     }

//     if (!response.ok || json.status !== "success") {
//         console.error("NETS QR request failed:", json);
//         const message =
//             json?.result?.message || json?.message || "NETS QR request failed";
//         throw new Error(message);
//     }

//     const data = json?.result?.data;

//     console.log("NETS raw response:", JSON.stringify(json, null, 2));
//     console.log("NETS data.qr_code type:", typeof data?.qr_code);
//     console.log("NETS data.qr_code value:", data?.qr_code);

//     if (!data || !data.qr_code || !data.txn_retrieval_ref) {
//         console.error("Invalid NETS QR payload:", data);
//         throw new Error("NETS QR response is missing QR data.");
//     }

//     const qrDataUrl = await QRCode.toDataURL(String(data.qr_code));

//     return {
//         qrDataUrl,
//         txnRetrievalRef: data.txn_retrieval_ref,
//         txnId,
//         raw: json,
//     };
// }

// async function queryTransaction(txnRetrievalRef, frontendTimeoutStatus = 1) {
//     ensureCreds();

//     const body = {
//         txn_retrieval_ref: txnRetrievalRef,
//         frontend_timeout_status: frontendTimeoutStatus,
//     };

//     const response = await fetch(
//         `${NETS_BASE_URL}/api/v1/common/payments/nets-qr/query`,
//         {
//             method: "POST",
//             headers: buildHeaders(),
//             body: JSON.stringify(body),
//         }
//     );

//     let json;
//     try {
//         json = await response.json();
//     } catch (err) {
//         const text = await response.text();
//         console.error("NETS query non-JSON response:", text);
//         throw new Error("NETS query returned non-JSON response");
//     }

//     if (!response.ok || json.status !== "success") {
//         const message =
//             json?.result?.message || json?.message || "NETS query failed";
//         throw new Error(message);
//     }

//     return json?.result?.data || {};
// }

// module.exports = {
//     requestQr,
//     queryTransaction,
// };

const axios = require("axios");
require("dotenv").config();

const NETS_BASE_URL =
    process.env.NETS_BASE_URL || "https://sandbox.nets.openapipaas.com";

function getCreds() {
    const apiKey = process.env.NETS_API_KEY || process.env.API_KEY;
    const projectId = process.env.NETS_PROJECT_ID || process.env.PROJECT_ID;
    return { apiKey, projectId };
}

function ensureCreds() {
    const { apiKey, projectId } = getCreds();
    const missing = [];
    if (!apiKey) missing.push("NETS_API_KEY (or API_KEY)");
    if (!projectId) missing.push("NETS_PROJECT_ID (or PROJECT_ID)");
    if (missing.length) throw new Error("NETS credentials missing: " + missing.join(", "));
}

function buildHeaders() {
    const { apiKey, projectId } = getCreds();
    const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "api-key": String(apiKey),
        "project-id": String(projectId)
    };
    return headers;
}

async function parseJsonOrThrow(response, contextLabel) {
    const text = await response.text();
    try {
        return JSON.parse(text);
    } catch (err) {
        throw new Error(
            `${contextLabel} response not JSON (status ${response.status}): ${text.slice(
                0,
                200
            )}`
        );
    }
}

// ✅ matches lesson slides: txn_id, amt_in_dollars, notify_mobile only
async function requestQr({ txnId, amount, notifyMobile = 0 }) {
    ensureCreds();

    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
        throw new Error("Invalid amount for NETS QR.");
    }

    // Align with sandbox example payload (amount object, reference)
    const body = {
        txn_id: String(txnId),
        amount: {
            value: Number(amountNumber.toFixed(2)),
            currency: "SGD",
        },
        reference: String(txnId)
    };

    console.log("NETS request headers:", buildHeaders());
    console.log("NETS request body:", body);

    const bodyString = JSON.stringify(body);

    try {
        const response = await axios.post(
            `${NETS_BASE_URL}/qr/request`,
            body,
            {
                headers: buildHeaders(),
                validateStatus: () => true // Don't throw on any status code
            }
        );

        console.log("NETS API Response Status:", response.status);
        console.log("NETS API Response Body:", JSON.stringify(response.data, null, 2));

        const json = response.data;

        if (response.status !== 200 || json.status !== "success") {
            const message = json?.result?.message || json?.message || "NETS QR request failed";
            console.error("NETS QR request failed with message:", message);
            throw new Error(message);
        }

        const data = json?.result?.data;
        if (!data?.qr_code || !data?.txn_retrieval_ref) {
            console.error("NETS QR missing fields:", json);
            throw new Error("NETS QR response missing qr_code / txn_retrieval_ref");
        }

        // qr_code is base64 png string (no prefix)
        const qrDataUrl = `data:image/png;base64,${String(data.qr_code)}`;

        return {
            qrDataUrl,
            txnRetrievalRef: String(data.txn_retrieval_ref),
            txnId: String(txnId),
            raw: json
        };
    } catch (err) {
        console.error("NETS request axios error:", err.message);
        throw err;
    }
}

async function queryTransaction(txnRetrievalRef) {
    ensureCreds();
    const body = {
        txn_retrieval_ref: String(txnRetrievalRef),
        frontend_timeout_status: 1 // required by sandbox docs when polling after UI
    };

    // Log for debugging
    const bodyString = JSON.stringify(body);
    console.log("NETS query headers:", buildHeaders());
    console.log("NETS query body string:", bodyString);
    console.log("NETS query body length:", Buffer.byteLength(bodyString));

    try {
        const response = await axios.post(
            `${NETS_BASE_URL}/api/v1/common/payments/nets-qr/query`,
            body,
            {
                headers: buildHeaders(),
                validateStatus: () => true // Don't throw on any status code
            }
        );

        console.log("NETS query response status:", response.status);
        console.log("NETS query response body:", JSON.stringify(response.data, null, 2));

        const json = response.data;

        // Sandbox sometimes returns 404/400 while still processing; treat as pending
        if (response.status === 404) {
            return { txn_status: 0, response_code: "PENDING" };
        }

        if (response.status !== 200 || json.status !== "success") {
            const message = json?.result?.message || json?.message || "NETS query failed";
            throw new Error(message);
        }

        return json?.result?.data || {};
    } catch (err) {
        console.error("NETS query axios error:", err.message);
        throw err;
    }
}

module.exports = { requestQr, queryTransaction };
