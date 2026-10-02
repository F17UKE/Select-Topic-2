require('./env.cjs');
const { createApp } = require('./app.cjs');
const { createDatabase, createDatabaseProbe } = require('./database.cjs');
const { serverConfig, paymentConfig } = require('./config.cjs');
const { createCustomerAuth, customerAuthConfig } = require('./auth.cjs');
const { createCustomerRepository } = require('./customer-repository.cjs');
const { createStoreRepository } = require('./store-repository.cjs');
const { createOrderService } = require('./order-service.cjs');
const { createPersistentIdempotencyStore } = require('./idempotency.cjs');
const { createSlipStorage } = require('./slip-storage.cjs');
const { createSlipRetention, startSlipRetentionWorker } = require('./slip-retention.cjs');
const { createPaymentVerifier } = require('./payment-verifier.cjs');
const { createPaymentService } = require('./payment-service.cjs');
const { createMerchantStaffAuth, merchantStaffAuthConfig } = require('./staff-auth.cjs');
const { createMerchantOrderService } = require('./merchant-order-service.cjs');
const { createRiderOrderService } = require('./rider-order-service.cjs');
const { lineIntegrationConfig } = require('./line-config.cjs');
const { createLineIdentityProvider } = require('./line-identity-provider.cjs');
const { createLineMessagingService } = require('./line-messaging-service.cjs');
const { createLineWebhook } = require('./line-webhook.cjs');
const { createNotificationOutbox, startNotificationOutboxWorker } = require('./notification-outbox.cjs');
const { securityConfig } = require('./security-config.cjs');

const db = createDatabase();
const { host, port } = serverConfig();
if (!db) throw new Error('Database configuration is required for application routes');
const lineConfig = lineIntegrationConfig();
const auth = createCustomerAuth({
  db,
  config: customerAuthConfig(),
  identityProvider: createLineIdentityProvider(),
});
const staffAuth = createMerchantStaffAuth({ db, config: merchantStaffAuthConfig() });
const paymentsConfig = paymentConfig();
const messaging = createLineMessagingService({ config: lineConfig });
const outbox = createNotificationOutbox({ db, messaging, publicAppUrl: lineConfig.publicAppUrl });
const storage = createSlipStorage(paymentsConfig);
const idempotency = createPersistentIdempotencyStore({ db });
const lineWebhook = lineConfig.webhookSecret ? createLineWebhook({ secret: lineConfig.webhookSecret, db }) : null;
const outboxWorker = startNotificationOutboxWorker(outbox);
const retentionWorker = startSlipRetentionWorker(createSlipRetention({ db, storage }));
const operationalRetentionTimer = setInterval(() => {
  Promise.allSettled([idempotency.pruneExpired(), lineWebhook?.pruneExpired()]);
}, 60 * 60 * 1000);
operationalRetentionTimer.unref();
const server = createApp({
  checkDatabase: createDatabaseProbe(db),
  auth,
  customers: createCustomerRepository(db),
  stores: createStoreRepository(db),
  orders: createOrderService(db),
  idempotency,
  payments: createPaymentService({
    db,
    config: paymentsConfig,
    storage,
    verifier: createPaymentVerifier(paymentsConfig),
    notifier: outbox,
  }),
  staffAuth,
  merchantOrders: createMerchantOrderService(db, { notifier: outbox }),
  riderOrders: createRiderOrderService(db, { notifier: outbox }),
  lineWebhook,
  security: securityConfig(),
}).listen(port, host, () => {
  console.log(`Backend listening on ${host}:${port}`);
});
server.on('error', (error) => {
  console.error(`Backend listen failed: ${error.code || 'unknown'}`);
  process.exit(1);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  outboxWorker.stop();
  retentionWorker.stop();
  clearInterval(operationalRetentionTimer);
  const deadline = setTimeout(() => process.exit(1), 8000);
  deadline.unref();
  server.close(async () => {
    try { if (db) await db.destroy(); process.exit(0); }
    catch { process.exit(1); }
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
