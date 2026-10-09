// Explicit provider-only verification. No database/payment service imports or persistence.
const fs = require('node:fs/promises');
const path = require('node:path');
require('../src/env.cjs');
const { paymentConfig } = require('../src/config.cjs');
const { createEasyslipProvider } = require('../src/payment-verifiers/easyslip-provider.cjs');
const { detectImage } = require('../src/slip-storage.cjs');

async function main() {
  if (process.argv[2] !== '--confirm-real-verification') {
    console.log('NOT RUN — explicit --confirm-real-verification <private-image> <merchant-id> <THB-amount> required'); return;
  }
  if (!process.env.EASYSLIP_API_KEY) { console.log('NOT RUN — credentials unavailable'); return; }
  const [, , , imagePath, merchantId, expectedAmount] = process.argv;
  if (!imagePath || !/^[1-9]\d*$/.test(merchantId || '')) throw Error('invalid_arguments');
  const root = await fs.realpath(path.resolve(__dirname, '../..'));
  const image = await fs.realpath(path.resolve(imagePath));
  const relative = path.relative(root, image);
  if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw Error('private_image_must_be_outside_repository');
  const info = await fs.stat(image);
  if (!info.isFile() || !info.size || info.size > 4194304) throw Error('invalid_image_size');
  const buffer = await fs.readFile(image);
  const detected = detectImage(buffer);
  if (!detected) throw Error('invalid_image');
  const config = paymentConfig({ ...process.env, PAYMENT_VERIFICATION_MODE: 'easyslip' });
  const mapping = config.easyslipMerchantAccounts[merchantId];
  const result = await createEasyslipProvider(config).verify({ merchantId, expectedAmount,
    expectedRecipient: mapping?.promptpayId, expectedRecipientType: mapping?.promptpayType,
    orderCode: 'MANUAL-NO-ORDER', fileBuffer: buffer, contentType: detected.contentType });
  console.log(JSON.stringify({ status: result.status, ...result.rawRedacted }));
}
main().catch(() => { console.error('STOP — verification unavailable; check protected configuration/input. No DB writes.'); process.exitCode = 1; });
