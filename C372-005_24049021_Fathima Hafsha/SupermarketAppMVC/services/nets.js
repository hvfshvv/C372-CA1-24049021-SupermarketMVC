const axios = require("axios");

const NETS_API_BASE = "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr";

const getAxiosConfig = () => {
  // Check both naming conventions
  const apiKey = process.env.API_KEY || process.env.NETS_API_KEY;
  const projectId = process.env.PROJECT_ID || process.env.NETS_PROJECT_ID;
  
  if (!apiKey || !projectId) {
    throw new Error("NETS API credentials not configured. Set API_KEY and PROJECT_ID (or NETS_API_KEY and NETS_PROJECT_ID) in .env");
  }
  
  console.log("NETS credentials check - using keys:", {
    apiKeySource: process.env.API_KEY ? "API_KEY" : "NETS_API_KEY",
    projectIdSource: process.env.PROJECT_ID ? "PROJECT_ID" : "NETS_PROJECT_ID",
  });
  
  return {
    headers: {
      "api-key": apiKey,
      "project-id": projectId,
      "Content-Type": "application/json",
    },
  };
};

/**
 * Request a QR code from NETS
 * @param {Object} options - { txnId, amount, notifyMobile }
 * @returns {Object} { qrDataUrl, txnRetrievalRef, ... }
 */
exports.requestQr = async (options) => {
  try {
    const { txnId, amount, notifyMobile = 0 } = options;

    if (!txnId || !amount) {
      throw new Error("txnId and amount are required");
    }

    const requestBody = {
      txn_id: txnId,
      amt_in_dollars: amount,
      notify_mobile: notifyMobile,
    };

    console.log("NETS requestQr - sending request:", {
      url: `${NETS_API_BASE}/request`,
      payload: requestBody,
      hasApiKey: !!process.env.API_KEY,
      hasProjectId: !!process.env.PROJECT_ID,
    });

    const response = await axios.post(
      `${NETS_API_BASE}/request`,
      requestBody,
      getAxiosConfig()
    );

    const qrData = response.data.result?.data;
    if (!qrData) {
      console.error("NETS response structure invalid:", response.data);
      throw new Error("Invalid NETS response structure");
    }

    console.log("NETS QR generated successfully:", {
      response_code: qrData.response_code,
      txn_status: qrData.txn_status,
      txn_retrieval_ref: qrData.txn_retrieval_ref,
      has_qr_code: !!qrData.qr_code,
    });

    if (qrData.response_code !== "00" || qrData.txn_status !== 1) {
      const errorMsg = qrData.instruction || `Code: ${qrData.response_code}`;
      throw new Error(`NETS request failed: ${errorMsg}`);
    }

    if (!qrData.qr_code) {
      throw new Error("NETS response did not include QR code data");
    }

    return {
      qrDataUrl: `data:image/png;base64,${qrData.qr_code}`,
      txnRetrievalRef: qrData.txn_retrieval_ref,
      responseCode: qrData.response_code,
      txnStatus: qrData.txn_status,
      networkStatus: qrData.network_status,
      fullResponse: qrData,
    };
  } catch (error) {
    console.error("NETS requestQr error:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      responseData: error.response?.data,
    });
    throw error;
  }
};

/**
 * Query the status of a NETS transaction
 * @param {string} txnRetrievalRef - Transaction retrieval reference
 * @returns {Object} Transaction status data
 */
exports.queryTransaction = async (txnRetrievalRef) => {
  try {
    if (!txnRetrievalRef) {
      throw new Error("txnRetrievalRef is required");
    }

    const requestBody = {
      txn_retrieval_ref: txnRetrievalRef,
    };

    console.log("NETS query - sending request with txn_retrieval_ref:", txnRetrievalRef);

    const response = await axios.post(
      `${NETS_API_BASE}/query`,
      requestBody,
      getAxiosConfig()
    );

    const statusData = response.data.result?.data;
    if (!statusData) {
      console.error("NETS query response invalid:", response.data);
      throw new Error("Invalid NETS query response structure");
    }

    console.log("NETS query response:", {
      response_code: statusData.response_code,
      txn_status: statusData.txn_status,
    });

    return {
      responseCode: statusData.response_code,
      txnStatus: statusData.txn_status,
      networkStatus: statusData.network_status,
      fullResponse: statusData,
    };
  } catch (error) {
    console.error("NETS queryTransaction error:", {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
    });
    throw error;
  }
};

// Legacy method for backward compatibility (if needed elsewhere)
exports.generateQrCode = async (req, res) => {
  const { cartTotal } = req.body;
  console.log("Legacy generateQrCode called with cartTotal:", cartTotal);

  try {
    const crypto = require("crypto");
    const txnId = `sandbox_nets|m|${crypto.randomUUID()}`;

    const qrResult = await exports.requestQr({
      txnId,
      amount: Math.max(1, Math.round(cartTotal)),
      notifyMobile: 0,
    });

    res.render("netsQr", {
      total: cartTotal,
      title: "Scan to Pay",
      qrCodeUrl: qrResult.qrDataUrl,
      txnRetrievalRef: qrResult.txnRetrievalRef,
      networkCode: qrResult.networkStatus,
      timer: 300,
      fullNetsResponse: qrResult.fullResponse,
      apiKey: process.env.API_KEY,
      projectId: process.env.PROJECT_ID,
    });
  } catch (error) {
    console.error("Error in generateQrCode:", error.message);
    res.status(500).render("netsQrFail", {
      title: "Error",
      responseCode: "ERROR",
      instructions: "",
      errorMsg: error.message || "Failed to generate QR code",
    });
  }
};
