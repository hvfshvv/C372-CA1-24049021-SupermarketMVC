const fetch = require("node-fetch");
const QRCode = require("qrcode");
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
    if (!apiKey || !projectId) {
        const missing = [];
        if (!apiKey) missing.push("NETS_API_KEY (or API_KEY)");
        if (!projectId) missing.push("NETS_PROJECT_ID (or PROJECT_ID)");
        throw new Error("NETS credentials missing: " + missing.join(", "));
    }
}

function buildHeaders() {
    const { apiKey, projectId } = getCreds();
    return {
        "Content-Type": "application/json",
        "api-key": String(apiKey),
        "project-id": String(projectId),
    };
}

async function requestQr({ txnId, amount, notifyMobile = 0 }) {
    ensureCreds();

    const amountNumber = Number(amount);
    const normalizedAmount = Number.isFinite(amountNumber)
        ? amountNumber.toFixed(2)
        : "0.00";

    const body = {
        txn_id: txnId,
        amt_in_dollars: normalizedAmount,
        notify_mobile: notifyMobile,

        tid_nets: "",
        mid_nets: "",
    };

    const response = await fetch(
        `${NETS_BASE_URL}/api/v1/common/payments/nets-qr/request`,
        {
            method: "POST",
            headers: buildHeaders(),
            body: JSON.stringify(body),
        }
    );

    let json;
    try {
        json = await response.json();
    } catch (err) {
        const text = await response.text();
        console.error("NETS QR request non-JSON response:", text);
        throw new Error("NETS QR request returned non-JSON response");
    }

    if (!response.ok || json.status !== "success") {
        console.error("NETS QR request failed:", json);
        const message =
            json?.result?.message || json?.message || "NETS QR request failed";
        throw new Error(message);
    }

    const data = json?.result?.data;

    console.log("NETS raw response:", JSON.stringify(json, null, 2));
    console.log("NETS data.qr_code type:", typeof data?.qr_code);
    console.log("NETS data.qr_code value:", data?.qr_code);

    if (!data || !data.qr_code || !data.txn_retrieval_ref) {
        console.error("Invalid NETS QR payload:", data);
        throw new Error("NETS QR response is missing QR data.");
    }

    const qrDataUrl = await QRCode.toDataURL(String(data.qr_code));

    return {
        qrDataUrl,
        txnRetrievalRef: data.txn_retrieval_ref,
        txnId,
        raw: json,
    };
}

async function queryTransaction(txnRetrievalRef, frontendTimeoutStatus = 1) {
    ensureCreds();

    const body = {
        txn_retrieval_ref: txnRetrievalRef,
        frontend_timeout_status: frontendTimeoutStatus,
    };

    const response = await fetch(
        `${NETS_BASE_URL}/api/v1/common/payments/nets-qr/query`,
        {
            method: "POST",
            headers: buildHeaders(),
            body: JSON.stringify(body),
        }
    );

    let json;
    try {
        json = await response.json();
    } catch (err) {
        const text = await response.text();
        console.error("NETS query non-JSON response:", text);
        throw new Error("NETS query returned non-JSON response");
    }

    if (!response.ok || json.status !== "success") {
        const message =
            json?.result?.message || json?.message || "NETS query failed";
        throw new Error(message);
    }

    return json?.result?.data || {};
}

module.exports = {
    requestQr,
    queryTransaction,
};
