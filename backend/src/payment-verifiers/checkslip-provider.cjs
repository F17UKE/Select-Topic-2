const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { VerificationProviderError } = require('./errors.cjs');

const maximumResponseBytes = 512 * 1024;

function safeLog(logger, level, fields) {
  const method = logger?.[level];
  if (typeof method === 'function') method.call(logger, fields, 'CheckSlip verification');
}

function requestMultipart({ url, apiKey, connectTimeoutMs, requestTimeoutMs, fileBuffer, contentType, requestId,
  fields = { log: 'false' }, fileField = 'files', bearer = false }) {
  const boundary = `----select-topic-2-${crypto.randomBytes(12).toString('hex')}`;
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const before = Buffer.from(
    Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('')
    + `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="slip.${extension}"\r\n`
    + `Content-Type: ${contentType}\r\n\r\n`,
  );
  const after = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([before, fileBuffer, after]);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    let connectTimer;
    let requestTimer;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(requestTimer);
      callback(value);
    };
    const outgoing = transport.request(url, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': body.length,
        ...(bearer ? { authorization: `Bearer ${apiKey}` } : { 'x-authorization': apiKey }),
        'x-request-id': requestId,
        accept: 'application/json',
      },
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > maximumResponseBytes) {
          const error = new Error('checkslip_response_too_large');
          error.code = 'checkslip_response_too_large';
          response.destroy(error);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => finish(resolve, {
        statusCode: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('error', (error) => finish(reject, error));
    });
    outgoing.on('socket', (socket) => {
      if (!socket.connecting) return;
      connectTimer = setTimeout(() => {
        const error = new Error('checkslip_connect_timeout');
        error.code = 'checkslip_connect_timeout';
        outgoing.destroy(error);
      }, connectTimeoutMs);
      socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', () => clearTimeout(connectTimer));
    });
    outgoing.on('error', (error) => finish(reject, error));
    requestTimer = setTimeout(() => {
      const error = new Error('checkslip_request_timeout');
      error.code = 'checkslip_request_timeout';
      outgoing.destroy(error);
    }, requestTimeoutMs);
    outgoing.end(body);
  });
}

function parseJson(body, requestId, httpStatus) {
  try {
    return JSON.parse(body);
  } catch {
    throw new VerificationProviderError('CHECKSLIP_INVALID_JSON', {
      providerRequestId: requestId, httpStatus,
    });
  }
}

function responseRequestId(payload, headers, fallback) {
  return String(
    headers['x-request-id'] || headers['x-correlation-id'] || payload?.requestId
    || payload?.request_id || payload?.data?.requestId || fallback,
  ).slice(0, 200);
}

function rejectionCode(payload, httpStatus) {
  const providerCode = String(payload?.code ?? payload?.data?.code ?? '').trim();
  if (providerCode === '1012') return 'CHECKSLIP_DUPLICATE_SLIP';
  if (providerCode === '1013') return 'CHECKSLIP_AMOUNT_MISMATCH';
  if (providerCode === '1014') return 'CHECKSLIP_RECIPIENT_MISMATCH';
  return httpStatus === 400 || httpStatus === 422 ? 'CHECKSLIP_BAD_REQUEST' : null;
}

function redactedResult({ status, requestId, httpStatus, transactionReference, amount, recipient, failureCode }) {
  return {
    provider: 'slipok-checkslip', status, request_id: requestId, http_status: httpStatus,
    transaction_reference: transactionReference || null,
    amount: Number.isFinite(amount) ? amount : null,
    recipient_type: recipient?.type || null,
    recipient_last4: recipient?.value ? String(recipient.value).replace(/[^0-9Xx*]/g, '').slice(-4) : null,
    error_code: failureCode || null,
  };
}

function normalizeRejected(payload, headers, fallbackRequestId, httpStatus, failureCode) {
  const data = payload?.data;
  const requestId = responseRequestId(payload, headers, fallbackRequestId);
  const amount = Number(data?.amount);
  const recipient = data?.receiver?.proxy?.value ? {
    type: data.receiver.proxy.type || null, value: String(data.receiver.proxy.value),
  } : null;
  return {
    status: 'REJECTED', provider: 'slipok-checkslip', providerRequestId: requestId,
    transactionReference: data?.transRef ? String(data.transRef) : null,
    amount: Number.isFinite(amount) ? amount : null,
    recipient, failureCode,
    rawRedacted: redactedResult({ status: 'REJECTED', requestId, httpStatus, failureCode }),
  };
}

function normalizeSuccess(payload, headers, fallbackRequestId, httpStatus) {
  const data = payload?.data;
  const requestId = responseRequestId(payload, headers, fallbackRequestId);
  if (payload?.success !== true || !data || data.success === false) {
    return normalizeRejected(
      payload, headers, fallbackRequestId, httpStatus,
      rejectionCode(payload, httpStatus) || 'CHECKSLIP_REJECTED',
    );
  }
  const transactionReference = String(data.transRef || '').trim();
  const amount = Number(data.amount);
  const proxy = data.receiver?.proxy;
  if (!transactionReference || !Number.isFinite(amount) || amount < 0 || !proxy?.value) {
    throw new VerificationProviderError('CHECKSLIP_MALFORMED_RESPONSE', {
      providerRequestId: requestId, httpStatus,
    });
  }
  const recipient = { type: proxy.type || null, value: String(proxy.value) };
  return {
    status: 'VERIFIED', provider: 'slipok-checkslip', providerRequestId: requestId,
    transactionReference, amount, recipient, failureCode: null,
    rawRedacted: redactedResult({
      status: 'VERIFIED', requestId, httpStatus, transactionReference, amount, recipient,
    }),
  };
}

function createCheckslipProvider(config, { logger = console, randomUUID = crypto.randomUUID, request = requestMultipart } = {}) {
  return {
    name: 'slipok-checkslip',
    async verify({ fileBuffer, contentType, paymentId, orderId }) {
      const localRequestId = randomUUID();
      let response;
      try {
        response = await request({
          url: config.checkslipApiUrl, apiKey: config.checkslipApiKey,
          connectTimeoutMs: config.checkslipConnectTimeoutMs,
          requestTimeoutMs: config.checkslipRequestTimeoutMs,
          fileBuffer, contentType, requestId: localRequestId,
        });
      } catch (error) {
        const code = error.code === 'checkslip_connect_timeout' ? 'CHECKSLIP_CONNECT_TIMEOUT'
          : error.code === 'checkslip_request_timeout' ? 'CHECKSLIP_REQUEST_TIMEOUT'
            : error.code === 'checkslip_response_too_large' ? 'CHECKSLIP_RESPONSE_TOO_LARGE'
              : 'CHECKSLIP_NETWORK_ERROR';
        safeLog(logger, 'error', {
          provider: 'slipok-checkslip', request_id: localRequestId, payment_id: paymentId,
          order_id: orderId, status: 'ERROR', error_code: code,
        });
        throw new VerificationProviderError(code, { providerRequestId: localRequestId });
      }

      let payload;
      try {
        payload = parseJson(response.body, localRequestId, response.statusCode);
      } catch (error) {
        safeLog(logger, 'error', {
          provider: 'slipok-checkslip', request_id: localRequestId, payment_id: paymentId,
          order_id: orderId, status: 'ERROR', error_code: error.code,
        });
        throw error;
      }
      const requestId = responseRequestId(payload, response.headers, localRequestId);
      if ([401, 403, 429].includes(response.statusCode) || response.statusCode >= 500) {
        const code = response.statusCode === 401 ? 'CHECKSLIP_UNAUTHORIZED'
          : response.statusCode === 403 ? 'CHECKSLIP_FORBIDDEN'
            : response.statusCode === 429 ? 'CHECKSLIP_RATE_LIMITED' : 'CHECKSLIP_UNAVAILABLE';
        safeLog(logger, 'error', {
          provider: 'slipok-checkslip', request_id: requestId, payment_id: paymentId,
          order_id: orderId, status: 'ERROR', error_code: code,
        });
        throw new VerificationProviderError(code, {
          providerRequestId: requestId, httpStatus: response.statusCode,
        });
      }
      let result;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        const failureCode = rejectionCode(payload, response.statusCode);
        if (!failureCode) {
          safeLog(logger, 'error', {
            provider: 'slipok-checkslip', request_id: requestId, payment_id: paymentId,
            order_id: orderId, status: 'ERROR', error_code: 'CHECKSLIP_HTTP_ERROR',
          });
          throw new VerificationProviderError('CHECKSLIP_HTTP_ERROR', {
            providerRequestId: requestId, httpStatus: response.statusCode,
          });
        }
        result = normalizeRejected(payload, response.headers, localRequestId, response.statusCode, failureCode);
      } else {
        try {
          result = normalizeSuccess(payload, response.headers, localRequestId, response.statusCode);
        } catch (error) {
          safeLog(logger, 'error', {
            provider: 'slipok-checkslip', request_id: requestId, payment_id: paymentId,
            order_id: orderId, status: 'ERROR', error_code: error.code,
          });
          throw error;
        }
      }
      safeLog(logger, 'info', {
        provider: result.provider, request_id: result.providerRequestId, payment_id: paymentId,
        order_id: orderId, status: result.status, error_code: result.failureCode,
      });
      return result;
    },
  };
}

module.exports = { createCheckslipProvider, normalizeSuccess, requestMultipart };
