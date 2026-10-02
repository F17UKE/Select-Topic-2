const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createCheckslipProvider } = require('../src/payment-verifiers/checkslip-provider.cjs');
const { identifiersMatch } = require('../src/payment-verifier.cjs');

const apiKey = 'synthetic-checkslip-key-never-real';
const image = Buffer.from('89504e470d0a1a0a5041594d454e54', 'hex');

async function withServer(handler, callback) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    return await callback(new URL(`http://127.0.0.1:${port}/api/line/apikey/test-branch`));
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function response(payload, statusCode = 200, headers = {}) {
  return (request, output) => {
    request.resume();
    request.on('end', () => {
      output.writeHead(statusCode, { 'content-type': 'application/json', ...headers });
      output.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    });
  };
}

function success(overrides = {}) {
  return {
    success: true,
    data: {
      success: true,
      transRef: 'CHECKSLIP-TX-001',
      amount: 79,
      receiver: { proxy: { type: 'MSISDN', value: '081XXX1111' } },
      ...overrides,
    },
  };
}

function provider(url, { logger = { info() {}, error() {} }, requestTimeoutMs = 1000 } = {}) {
  return createCheckslipProvider({
    checkslipApiUrl: url, checkslipApiKey: apiKey,
    checkslipConnectTimeoutMs: 500, checkslipRequestTimeoutMs: requestTimeoutMs,
  }, { logger, randomUUID: () => 'local-request-id' });
}

async function verify(adapter) {
  return adapter.verify({
    fileBuffer: image, contentType: 'image/png', paymentId: 12, orderId: 34,
  });
}

test('CheckSlip adapter uses HTTP only inside the adapter and normalizes/redacts responses', async (t) => {
  await t.test('verified success sends SlipOK multipart fields and exposes normalized fields only', async () => {
    let received;
    const result = await withServer((request, output) => {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        received = { headers: request.headers, body: Buffer.concat(chunks).toString('latin1') };
        output.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'provider-request-1' });
        output.end(JSON.stringify(success()));
      });
    }, (url) => verify(provider(url)));
    assert.deepEqual({
      status: result.status, reference: result.transactionReference, amount: result.amount,
      recipient: result.recipient, requestId: result.providerRequestId,
    }, {
      status: 'VERIFIED', reference: 'CHECKSLIP-TX-001', amount: 79,
      recipient: { type: 'MSISDN', value: '081XXX1111' }, requestId: 'provider-request-1',
    });
    assert.equal(received.headers['x-authorization'], apiKey);
    assert.match(received.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.match(received.body, /name="log"\r\n\r\nfalse/);
    assert.match(received.body, /name="files"; filename="slip.png"/);
    assert.equal(JSON.stringify(result.rawRedacted).includes('081XXX1111'), false);
    assert.equal(Object.hasOwn(result, 'raw'), false);
  });

  for (const [name, overrides, expected] of [
    ['amount mismatch remains visible for backend validation', { amount: 80 }, 80],
    ['recipient mismatch remains visible for backend validation', {
      receiver: { proxy: { type: 'MSISDN', value: '099XXX9999' } },
    }, '099XXX9999'],
  ]) {
    await t.test(name, async () => {
      const result = await withServer(response(success(overrides)), (url) => verify(provider(url)));
      assert.equal(name.startsWith('amount') ? result.amount : result.recipient.value, expected);
    });
  }

  await t.test('repeated provider transaction reference stays stable for database duplicate enforcement', async () => {
    const references = await withServer(response(success({ transRef: 'REUSED-TX-01' })), async (url) => {
      const adapter = provider(url);
      return [(await verify(adapter)).transactionReference, (await verify(adapter)).transactionReference];
    });
    assert.deepEqual(references, ['REUSED-TX-01', 'REUSED-TX-01']);
  });

  await t.test('provider 400 is a rejected verification', async () => {
    const result = await withServer(response({ success: false, code: 1001 }, 400), (url) => verify(provider(url)));
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.failureCode, 'CHECKSLIP_BAD_REQUEST');
  });

  for (const [statusCode, expected] of [
    [401, 'CHECKSLIP_UNAUTHORIZED'], [403, 'CHECKSLIP_FORBIDDEN'],
    [429, 'CHECKSLIP_RATE_LIMITED'], [500, 'CHECKSLIP_UNAVAILABLE'],
  ]) {
    await t.test(`provider ${statusCode} maps to ${expected}`, async () => {
      await withServer(response({ success: false, code: statusCode }, statusCode), async (url) => {
        await assert.rejects(verify(provider(url)), (error) => error.code === expected && error.httpStatus === statusCode);
      });
    });
  }

  await t.test('request timeout maps to retryable ERROR', async () => {
    await withServer((request, output) => {
      request.resume();
      setTimeout(() => { if (!output.destroyed) output.end(JSON.stringify(success())); }, 100);
    }, async (url) => {
      await assert.rejects(verify(provider(url, { requestTimeoutMs: 30 })), {
        code: 'CHECKSLIP_REQUEST_TIMEOUT', retryable: true,
      });
    });
  });

  await t.test('malformed JSON maps to ERROR', async () => {
    await withServer(response('{not-json', 200), async (url) => {
      await assert.rejects(verify(provider(url)), { code: 'CHECKSLIP_INVALID_JSON' });
    });
  });

  await t.test('malformed successful response maps to ERROR', async () => {
    await withServer(response({ success: true, data: { success: true, amount: 79 } }), async (url) => {
      await assert.rejects(verify(provider(url)), { code: 'CHECKSLIP_MALFORMED_RESPONSE' });
    });
  });

  await t.test('provider rejection codes are normalized without exposing response internals', async () => {
    const result = await withServer(response({ success: false, code: 1012 }, 422), (url) => verify(provider(url)));
    assert.equal(result.failureCode, 'CHECKSLIP_DUPLICATE_SLIP');
    assert.deepEqual(Object.keys(result.rawRedacted).sort(), [
      'amount', 'error_code', 'http_status', 'provider', 'recipient_last4',
      'recipient_type', 'request_id', 'status', 'transaction_reference',
    ]);
  });

  await t.test('safe logs do not contain API key, full recipient or response payload', async () => {
    const logs = [];
    const logger = { info: (...values) => logs.push(values), error: (...values) => logs.push(values) };
    await withServer(response(success()), (url) => verify(provider(url, { logger })));
    const serialized = JSON.stringify(logs);
    assert.equal(serialized.includes(apiKey), false);
    assert.equal(serialized.includes('081XXX1111'), false);
    assert.match(serialized, /payment_id/);
    assert.match(serialized, /order_id/);
  });
});

test('recipient matching supports SlipOK masked PromptPay identities without accepting changed digits', () => {
  assert.equal(identifiersMatch('081XXX1111', '0811111111'), true);
  assert.equal(identifiersMatch('089XXX1111', '0811111111'), false);
  assert.equal(identifiersMatch('X-XXXX-XXXXX-XX-X', '1101700203451'), true);
  assert.equal(identifiersMatch('', '0811111111'), false);
});
