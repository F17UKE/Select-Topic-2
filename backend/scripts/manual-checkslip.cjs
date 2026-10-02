const fs = require('node:fs/promises');
const path = require('node:path');
require('../src/env.cjs');
const { paymentConfig } = require('../src/config.cjs');
const { createPaymentVerifier } = require('../src/payment-verifier.cjs');

async function main() {
  const slipPath = process.argv[2];
  if (!process.env.CHECKSLIP_API_URL || !process.env.CHECKSLIP_API_KEY) {
    console.log('NOT RUN — credentials unavailable');
    return;
  }
  if (!slipPath) throw new Error('Usage: npm run checkslip:manual -- <private-slip-path>');
  const extension = path.extname(slipPath).toLowerCase();
  const contentType = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  const verifier = createPaymentVerifier(paymentConfig({
    ...process.env,
    PAYMENT_VERIFICATION_MODE: 'checkslip',
  }));
  const result = await verifier.verify({
    fileBuffer: await fs.readFile(slipPath), contentType,
    paymentId: 'manual', orderId: 'manual',
  });
  console.log(JSON.stringify(result.rawRedacted, null, 2));
}

main().catch((error) => {
  console.error(`Manual CheckSlip test failed: ${error.code || error.message}`);
  process.exitCode = 1;
});
