const crypto = require('node:crypto');
const { VerificationProviderError } = require('./errors.cjs');
const { satang } = require('../payment-money.cjs');

const maximumResponseBytes = 512 * 1024;

// Only known separators are canonicalized. Masked/other characters never become digits.
const accountDigits = (value) => typeof value === 'string' && /^[\d -]+$/.test(value) ? value.replace(/[ -]/g, '') : null;
const imageRejections = new Set(['SLIP_NOT_FOUND', 'INVALID_IMAGE_FORMAT', 'INVALID_IMAGE_TYPE', 'IMAGE_SIZE_TOO_LARGE']);
const providerErrors = new Set([
  'SLIP_PENDING', 'MISSING_API_KEY', 'INVALID_API_KEY', 'BRANCH_INACTIVE', 'SERVICE_BANNED', 'USER_BANNED',
  'SERVICE_DELETED', 'SERVICE_EXPIRED', 'IP_NOT_ALLOWED', 'QUOTA_EXCEEDED', 'RATE_LIMIT_EXCEEDED',
  'VALIDATION_ERROR', 'BANK_ACCOUNT_NOT_FOUND', 'API_SERVER_ERROR', 'INTERNAL_SERVER_ERROR',
]);

function rejected(code, requestId, httpStatus) {
  return {
    provider: 'easyslip-v2', providerRequestId: requestId, status: 'REJECTED', failureCode: code,
    transactionReference: null, amount: null, recipient: null, recipientVerified: false,
    rawRedacted: { provider: 'easyslip-v2', http_status: httpStatus, verification_stage: 'UPLOAD', failure_code: code },
  };
}

function recipientMapping(config, input) {
  // financeRecipient is resolved server-side from the order's immutable encrypted version.
  const mapping = input.financeRecipient || config.easyslipMerchantAccounts?.[String(input.merchantId)];
  if (!mapping || mapping.promptpayType !== input.expectedRecipientType
    || mapping.promptpayId !== input.expectedRecipient
    || !/^\d{3}$/.test(mapping.bankCode) || !/^\d{6,20}$/.test(mapping.bankNumber)) {
    throw new VerificationProviderError('EASYSLIP_RECIPIENT_NOT_CONFIGURED');
  }
  return mapping;
}

function parseResult(payload, input, mapping, requestId) {
  const data = payload?.data;
  const fail = (code) => { throw new VerificationProviderError(code, { providerRequestId: requestId }); };
  if (payload?.success !== true) fail('EASYSLIP_VERIFICATION_FAILED');
  const raw = data?.rawSlip;
  const reference = raw?.transRef;
  if (!data || typeof data.isDuplicate !== 'boolean' || typeof data.isAmountMatched !== 'boolean'
    || typeof reference !== 'string' || !/^[A-Za-z0-9_.:-]{1,255}$/.test(reference)
    || !raw?.date || !Number.isFinite(Date.parse(raw.date))
    || satang(data.amountInSlip) === null || satang(raw?.amount?.amount) === null
    || satang(data.amountInOrder) === null) fail('EASYSLIP_MALFORMED_RESPONSE');
  const amountMatches = data.isAmountMatched === true
    && satang(data.amountInOrder) === satang(input.expectedAmount)
    && satang(data.amountInSlip) === satang(input.expectedAmount)
    && satang(raw.amount.amount) === satang(input.expectedAmount);
  const account = data.matchedAccount;
  const rawBank = raw.receiver?.account?.bank;
  const rawBankDigits = accountDigits(rawBank?.account);
  const rawBankCode = raw.receiver?.bank?.id;
  // matchedAccount is the exact branch account returned because matchAccount=true. The raw slip
  // may expose a PromptPay proxy, token, or masked representation. Only a canonical BANKAC value
  // is an independent bank-account assertion that must agree with the immutable mapping.
  const matchedAccountMatches = account?.bank?.code === mapping.bankCode
    && accountDigits(account?.bankNumber) === mapping.bankNumber;
  const rawHasCanonicalBankAccount = rawBank?.type === 'BANKAC'
    && Boolean(rawBankDigits)
    && /^\d{3}$/.test(String(rawBankCode || ''));
  const rawBankConsistent = !rawHasCanonicalBankAccount
    || (rawBankCode === mapping.bankCode && rawBankDigits === mapping.bankNumber);
  const recipientMatches = matchedAccountMatches && rawBankConsistent;
  const failureCode = !amountMatches ? 'AMOUNT_MISMATCH' : !recipientMatches ? 'RECIPIENT_MISMATCH' : null;
  return {
    provider: 'easyslip-v2', providerRequestId: requestId,
    status: failureCode ? 'REJECTED' : 'VERIFIED', failureCode,
    transactionReference: reference, amount: data.amountInSlip,
    providerDuplicate: data.isDuplicate === true,
    recipient: { type: input.expectedRecipientType, value: input.expectedRecipient },
    recipientVerified: Boolean(recipientMatches), merchantId: input.merchantId,
    rawRedacted: { provider: 'easyslip-v2', http_status: 200, duplicate: data.isDuplicate,
      amount_matches: amountMatches, recipient_matches: Boolean(recipientMatches),
      matched_account_compared: true, raw_receiver_account_compared: rawHasCanonicalBankAccount,
      verification_stage: failureCode === 'AMOUNT_MISMATCH' ? 'AMOUNT' : failureCode === 'RECIPIENT_MISMATCH' ? 'RECIPIENT' : 'FINALIZE',
      reference_digest: crypto.createHash('sha256').update(reference).digest('hex'), failure_code: failureCode },
  };
}

async function requestEasyslip({
  url, apiKey, requestTimeoutMs, fileBuffer, contentType, requestId, fields,
}) {
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
  const form = new FormData();
  form.append('image', new Blob([fileBuffer], { type: contentType }), `slip.${extension}`);
  for (const [name, value] of Object.entries(fields)) form.append(name, String(value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-request-id': requestId,
        accept: 'application/json',
      },
      body: form,
      signal: controller.signal,
    });
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maximumResponseBytes) {
      const error = new Error('easyslip_response_too_large');
      error.code = 'easyslip_response_too_large';
      throw error;
    }
    return { statusCode: response.status, headers: Object.fromEntries(response.headers), body: body.toString('utf8') };
  } finally {
    clearTimeout(timeout);
  }
}

function createEasyslipProvider(config, { request = requestEasyslip, randomUUID = crypto.randomUUID } = {}) {
  return {
    name: 'easyslip-v2',
    preflight(input) { recipientMapping(config, input); },
    async verify(input) {
      const mapping = recipientMapping(config, input);
      const cents = satang(input.expectedAmount);
      if (cents === null || cents <= 0) throw new VerificationProviderError('EASYSLIP_INVALID_AMOUNT');
      const requestId = randomUUID();
      let response;
      try {
        response = await request({ url: new URL(`${config.easyslipApiBaseUrl}/verify/bank`),
          apiKey: config.easyslipApiKey, bearer: true, fileField: 'image',
          fields: { remark: input.orderCode, matchAmount: (cents / 100).toFixed(2), matchAccount: 'true', checkDuplicate: 'true' },
          fileBuffer: input.fileBuffer, contentType: input.contentType, requestId,
          connectTimeoutMs: config.easyslipConnectTimeoutMs, requestTimeoutMs: config.easyslipRequestTimeoutMs });
      } catch {
        throw new VerificationProviderError('EASYSLIP_UNAVAILABLE', { providerRequestId: requestId, retryable: true });
      }
      let payload;
      try { payload = JSON.parse(response.body); }
      catch {
        const code = response.statusCode >= 500 ? 'EASYSLIP_UNAVAILABLE' : 'EASYSLIP_MALFORMED_RESPONSE';
        throw new VerificationProviderError(code, { providerRequestId: requestId, httpStatus: response.statusCode });
      }
      if (payload?.success === false) {
        const suppliedCode = typeof payload.error?.code === 'string' ? payload.error.code.trim().toUpperCase() : '';
        const code = providerErrors.has(suppliedCode) || imageRejections.has(suppliedCode) ? suppliedCode
          : response.statusCode === 429 ? 'RATE_LIMIT_EXCEEDED'
            : response.statusCode >= 500 ? 'EASYSLIP_UNAVAILABLE' : 'EASYSLIP_VERIFICATION_FAILED';
        if (imageRejections.has(code)) return rejected(code, requestId, response.statusCode);
        throw new VerificationProviderError(code, {
          providerRequestId: requestId, httpStatus: response.statusCode,
          retryable: ['SLIP_PENDING', 'RATE_LIMIT_EXCEEDED', 'API_SERVER_ERROR', 'EASYSLIP_UNAVAILABLE'].includes(code),
        });
      }
      if (response.statusCode !== 200) throw new VerificationProviderError('EASYSLIP_UNAVAILABLE', {
        providerRequestId: requestId, httpStatus: response.statusCode,
      });
      return parseResult(payload, input, mapping, requestId);
    },
  };
}
module.exports = { createEasyslipProvider, parseResult, recipientMapping, requestEasyslip };
