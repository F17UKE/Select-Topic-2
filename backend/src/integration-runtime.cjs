const { createPaymentService } = require('./payment-service.cjs');
const { createPaymentVerifier } = require('./payment-verifier.cjs');
const { createLineMessagingService } = require('./line-messaging-service.cjs');
const { createLineWebhook } = require('./line-webhook.cjs');
const { customerAuthConfig } = require('./auth.cjs');
const { HttpError } = require('./http.cjs');

function createIntegrationRuntime({ integrations, db, storage, storageConfig, notifier, identityProvider, messagingDependencies, verifierDependencies }) {
  const payments = { maxUploadBytes: storageConfig.maxUploadBytes, slipMaxUploadBytes: storageConfig.slipMaxUploadBytes };
  for (const method of ['createAttempt', 'getPayment', 'getQr', 'uploadAndVerify', 'reconcilePayment']) {
    payments[method] = async (...args) => {
      const { config, enabled } = await integrations.getPaymentIntegrationConfig({ readOnly: method === 'getPayment' });
      if (!enabled && method !== 'getPayment') throw new HttpError(503, 'payment_integration_disabled');
      // A single immutable configuration snapshot is used throughout this operation.
      const service = createPaymentService({ db, storage, notifier, config, verifier: method === 'getPayment' ? null : createPaymentVerifier(config, verifierDependencies) });
      return service[method](...args);
    };
  }
  const messaging = { push: async (...args) => createLineMessagingService({ config: await integrations.getLineIntegrationConfig(), ...messagingDependencies }).push(...args) };
  const webhook = {
    handle: async (...args) => {
      if (!args[1]) throw new HttpError(401, 'invalid_line_signature');
      const config = await integrations.getLineIntegrationConfig();
      if (!config.webhookEnabled || !config.webhookSecret) throw new HttpError(503, 'line_webhook_disabled');
      return createLineWebhook({ secret: config.webhookSecret, db }).handle(...args);
    },
    pruneExpired: () => createLineWebhook({ db }).pruneExpired(),
  };
  const resolveCustomerConfig = async () => {
    const env = await integrations.environment();
    return { ...customerAuthConfig(env), loginEnabled: env.LINE_LOGIN_ENABLED === 'true' };
  };
  return { payments, messaging, webhook, resolveCustomerConfig, identityProvider };
}
module.exports = { createIntegrationRuntime };
