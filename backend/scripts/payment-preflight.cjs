const { paymentConfig } = require('../src/config.cjs');
const { createEasyslipProvider } = require('../src/payment-verifiers/easyslip-provider.cjs');

function validateProductionPaymentEnvironment(env = process.env) {
  if (env.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production');
  const mode = env.PAYMENT_VERIFICATION_MODE || 'checkslip';
  if (!['checkslip', 'easyslip'].includes(mode)) {
    throw new Error('Production PAYMENT_VERIFICATION_MODE must be checkslip or easyslip; mock is forbidden');
  }
  const required = mode === 'easyslip'
    ? ['EASYSLIP_API_KEY', 'EASYSLIP_MERCHANT_ACCOUNTS']
    : ['CHECKSLIP_API_URL', 'CHECKSLIP_API_KEY'];
  const missing = required.filter((name) => !env[name] || /YOUR_|CHANGE_ME|<[^>]+>/i.test(env[name]));
  if (missing.length) throw new Error(`Missing or placeholder production variables: ${missing.join(', ')}`);
  // Reuse the runtime's URL, JSON, TLS and timeout validation; no provider calls.
  const config = paymentConfig(env);
  if (mode === 'easyslip') {
    const mappings = Object.entries(config.easyslipMerchantAccounts);
    const adapter = createEasyslipProvider(config);
    try {
      if (!mappings.length) throw new Error();
      for (const [merchantId, mapping] of mappings) {
        if (!/^[1-9]\d*$/.test(merchantId) || !mapping
          || typeof mapping.promptpayType !== 'string' || !mapping.promptpayType
          || typeof mapping.promptpayId !== 'string' || !mapping.promptpayId) throw new Error();
        adapter.preflight({ merchantId, expectedRecipientType: mapping.promptpayType, expectedRecipient: mapping.promptpayId });
      }
    } catch {
      throw new Error('EASYSLIP_MERCHANT_ACCOUNTS must contain valid merchant recipient mappings');
    }
  }
  return config;
}

module.exports = { validateProductionPaymentEnvironment };
