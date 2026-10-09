const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createEasyslipProvider } = require('../src/payment-verifiers/easyslip-provider.cjs');
const { satang } = require('../src/payment-money.cjs');
const { paymentConfig } = require('../src/config.cjs');
const { validatePromptPay } = require('../src/payment-service.cjs');
const generate = require('promptpay-qr');
const input = { merchantId: 99, expectedRecipient: '0800000099', expectedRecipientType: 'PHONE',
  expectedAmount: '435.00', orderCode: 'TEST-0001', fileBuffer: Buffer.from('fixture'), contentType: 'image/png' };
const mapping = { promptpayType: 'PHONE', promptpayId: input.expectedRecipient, bankCode: '999', bankNumber: '0000000099' };
const config = { easyslipApiBaseUrl: 'https://api.easyslip.com/v2', easyslipApiKey: 'synthetic-only',
  easyslipConnectTimeoutMs: 100, easyslipRequestTimeoutMs: 150, easyslipMerchantAccounts: { 99: mapping } };
const success = () => ({ success: true, data: { isDuplicate: false, isAmountMatched: true,
  amountInOrder: 435, amountInSlip: 435, matchedAccount: { bank: { code: '999' }, bankNumber: '0000000099' },
  rawSlip: { transRef: 'SYNTHETIC-001', date: '2026-10-01T00:00:00Z', amount: { amount: 435 },
    receiver: { bank: { id: '999' }, account: { bank: { account: '0000000099' } } } } } });
const adapter = (payload, override = {}) => createEasyslipProvider(config, { request: async () => ({ statusCode: 200, body: JSON.stringify(payload), ...override }) });

test('EasySlip strict parser accepts only exact merchant account and exact authoritative satang', async () => {
  const result = await adapter(success()).verify(input);
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.recipientVerified, true);
  assert.equal(result.amount, 435);
  const metadata = JSON.stringify(result.rawRedacted);
  for (const privateValue of [input.expectedRecipient, mapping.bankNumber, 'SYNTHETIC-001', 'rawSlip', 'sender']) assert.ok(!metadata.includes(privateValue));
});
for (const [name, change, code] of [
  ['amount flag false', (p) => { p.data.isAmountMatched = false; }, 'AMOUNT_MISMATCH'],
  ['amount mismatch', (p) => { p.data.amountInSlip = 434.99; }, 'AMOUNT_MISMATCH'],
  ['raw amount mismatch', (p) => { p.data.rawSlip.amount.amount = 434; }, 'AMOUNT_MISMATCH'],
  ['wrong request correlation', (p) => { p.data.amountInOrder = 1; }, 'AMOUNT_MISMATCH'],
  ['other registered account', (p) => { p.data.matchedAccount.bankNumber = '0000000088'; }, 'RECIPIENT_MISMATCH'],
  ['raw receiver wrong', (p) => { p.data.rawSlip.receiver.account.bank.account = '0000000088'; }, 'RECIPIENT_MISMATCH'],
  ['missing account', (p) => { p.data.matchedAccount = null; }, 'RECIPIENT_MISMATCH'],
]) test(`EasySlip rejects ${name}`, async () => {
  const payload = success(); change(payload);
  const result = await adapter(payload).verify(input);
  assert.equal(result.status, 'REJECTED'); assert.equal(result.failureCode, code);
});
test('EasySlip surfaces provider duplicate only after full amount/recipient validation', async () => {
  const payload = success(); payload.data.isDuplicate = true;
  const result = await adapter(payload).verify(input);
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.providerDuplicate, true);
  assert.equal(result.rawRedacted.duplicate, true);
  assert.equal(result.recipientVerified, true);
});
for (const [name, rawAccount] of [['masked', 'xxxxxx0099'], ['absent', undefined]]) test(`EasySlip accepts ${name} raw receiver when matchedAccount is exact`, async () => {
  const payload = success();
  if (rawAccount === undefined) delete payload.data.rawSlip.receiver.account.bank.account;
  else payload.data.rawSlip.receiver.account.bank.account = rawAccount;
  const result = await adapter(payload).verify(input);
  assert.equal(result.status, 'VERIFIED');
  assert.equal(result.rawRedacted.raw_receiver_account_compared, false);
});
for (const [name, change] of [
  ['empty ref', (p) => { p.data.rawSlip.transRef = ''; }],
  ['invalid ref', (p) => { p.data.rawSlip.transRef = 'a\nheader'; }],
  ['absent raw slip', (p) => { delete p.data.rawSlip; }],
  ['fractional satang', (p) => { p.data.amountInSlip = 435.001; }],
  ['string duplicate', (p) => { p.data.isDuplicate = 'false'; }],
  ['missing date', (p) => { delete p.data.rawSlip.date; }],
]) test(`EasySlip fails closed on ${name}`, async () => {
  const payload = success(); change(payload);
  await assert.rejects(adapter(payload).verify(input), { code: 'EASYSLIP_MALFORMED_RESPONSE' });
});
test('missing or changed merchant mapping stops before any request', async () => {
  let calls = 0;
  const provider = createEasyslipProvider(config, { request: async () => { calls++; } });
  for (const change of [{ merchantId: 100 }, { expectedRecipient: '0800000088' }, { expectedRecipientType: 'TAX_ID' }]) {
    await assert.rejects(provider.verify({ ...input, ...change }), { code: 'EASYSLIP_RECIPIENT_NOT_CONFIGURED' });
  }
  assert.equal(calls, 0);
});
for (const [statusCode, providerCode] of [
  [400, 'VALIDATION_ERROR'], [401, 'INVALID_API_KEY'], [403, 'IP_NOT_ALLOWED'], [403, 'QUOTA_EXCEEDED'], [403, 'SERVICE_EXPIRED'],
  [429, 'RATE_LIMIT_EXCEEDED'], [500, 'API_SERVER_ERROR'], [503, 'API_SERVER_ERROR'],
]) test(`EasySlip HTTP ${statusCode} preserves ${providerCode} without provider message`, async () => {
  const provider = adapter({ success: false, error: { code: providerCode, message: 'secret account detail' } }, { statusCode });
  await assert.rejects(provider.verify(input), (error) => error.code === providerCode
    && error.httpStatus === statusCode && error.message === providerCode && !error.message.includes('secret'));
});
test('EasySlip unknown HTTP 429 and 5xx errors use safe retryable mappings', async () => {
  await assert.rejects(adapter({ success: false, error: { code: 'UNKNOWN', message: 'secret' } }, { statusCode: 429 }).verify(input),
    (error) => error.code === 'RATE_LIMIT_EXCEEDED' && error.retryable === true && error.httpStatus === 429);
  await assert.rejects(adapter({ success: false, error: { code: 'UNKNOWN', message: 'secret' } }, { statusCode: 502 }).verify(input),
    (error) => error.code === 'EASYSLIP_UNAVAILABLE' && error.retryable === true && error.httpStatus === 502);
});
test('EasySlip malformed JSON and network errors are sanitized', async () => {
  await assert.rejects(adapter(null, { body: '<private>' }).verify(input), { code: 'EASYSLIP_MALFORMED_RESPONSE' });
  const provider = createEasyslipProvider(config, { request: async () => { throw Error('secret'); } });
  await assert.rejects(provider.verify(input), (error) => error.code === 'EASYSLIP_UNAVAILABLE' && !error.message.includes('secret'));
});
test('documented provider image/slip errors allow a new slip and SLIP_PENDING stays retryable', async () => {
  for (const code of ['SLIP_NOT_FOUND', 'INVALID_IMAGE_FORMAT', 'INVALID_IMAGE_TYPE', 'IMAGE_SIZE_TOO_LARGE']) {
    const result = await adapter({ success: false, error: { code, message: 'private provider details' } }, { statusCode: 404 }).verify(input);
    assert.equal(result.status, 'REJECTED'); assert.equal(result.failureCode, code);
    assert.ok(!JSON.stringify(result).includes('private provider'));
  }
  await assert.rejects(adapter({ success: false, error: { code: 'SLIP_PENDING' } }, { statusCode: 404 }).verify(input), { code: 'SLIP_PENDING' });
});
test('exact account formatting is normalized while matched account remains authoritative', async () => {
  const p = success(); p.data.matchedAccount.bankNumber = '000-000-0099'; p.data.rawSlip.receiver.account.bank.account = '000 000 0099';
  assert.equal((await adapter(p).verify(input)).status, 'VERIFIED');
});

test('native FormData transport against LOOPBACK ONLY sends v2 image, bearer and bounded request', async () => {
  let captured;
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      captured = { headers: req.headers, body: Buffer.concat(chunks).toString() };
      if (req.url === '/slow/verify/bank') return;
      res.writeHead(200); res.end(JSON.stringify(success()));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const provider = createEasyslipProvider({ ...config, easyslipApiBaseUrl: base });
    assert.equal((await provider.verify(input)).status, 'VERIFIED');
    assert.equal(captured.headers.authorization, 'Bearer synthetic-only');
    assert.equal(captured.headers['x-authorization'], undefined);
    assert.match(captured.headers['content-type'], /^multipart\/form-data; boundary=----formdata-undici-/);
    for (const text of ['name="image"', 'name="remark"', 'TEST-0001', 'name="matchAmount"', '435.00', 'name="matchAccount"', 'name="checkDuplicate"', 'true']) assert.ok(captured.body.includes(text));
    assert.ok(!captured.body.includes('name="files"'));
    const slow = createEasyslipProvider({ ...config, easyslipApiBaseUrl: `${base}/slow`, easyslipRequestTimeoutMs: 80 });
    await assert.rejects(slow.verify(input), { code: 'EASYSLIP_UNAVAILABLE' });
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
test('satang conversion and QR fixed-amount payload remain deterministic with valid CRC', () => {
  assert.equal(satang('435.00'), 43500); assert.equal(satang('0.29'), 29);
  for (const invalid of ['', null, NaN, '-1', '1e2', '1.001', '1.005']) assert.equal(satang(invalid), null);
  const phone = validatePromptPay('PHONE', '0800000099');
  const payload = generate(phone, { amount: satang('435.00') / 100 });
  assert.ok(payload.includes('5406435.00'));
  assert.notEqual(payload, generate(phone, { amount: 434.99 }));
  assert.equal(payload, generate(phone, { amount: 435 }));
  let crc = 0xffff;
  for (const byte of Buffer.from(payload.slice(0, -4))) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  assert.equal(payload.slice(-4), crc.toString(16).toUpperCase().padStart(4, '0'));
  assert.throws(() => validatePromptPay('PHONE', 'bad'));
});
test('config enforces backend key, production mock prohibition, fixed HTTPS origin and hard 4 MiB cap', () => {
  assert.throws(() => paymentConfig({ NODE_ENV: 'production', PAYMENT_VERIFICATION_MODE: 'mock' }));
  assert.throws(() => paymentConfig({ PAYMENT_VERIFICATION_MODE: 'easyslip' }), /EASYSLIP_API_KEY/);
  assert.throws(() => paymentConfig({ PAYMENT_VERIFICATION_MODE: 'easyslip', EASYSLIP_API_KEY: 'synthetic-only', EASYSLIP_API_BASE_URL: 'https://invalid.example' }));
  assert.equal(paymentConfig({ SLIP_MAX_BYTES: '5242880' }).slipMaxUploadBytes, 4194304);
  assert.equal(paymentConfig({ SLIP_MAX_BYTES: '5242880' }).maxUploadBytes, 5242880, 'non-payment asset limit unchanged');
});
