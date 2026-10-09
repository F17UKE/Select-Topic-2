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
const { createMerchantStaffAuth, merchantStaffAuthConfig } = require('./staff-auth.cjs');
const { createMerchantOrderService } = require('./merchant-order-service.cjs');
const { createRiderOrderService } = require('./rider-order-service.cjs');
const { createLineIdentityProvider } = require('./line-identity-provider.cjs');
const { createIntegrationSettings } = require('./integration-settings.cjs');
const { createIntegrationRuntime } = require('./integration-runtime.cjs');
const { createNotificationOutbox, startNotificationOutboxWorker } = require('./notification-outbox.cjs');
const { securityConfig } = require('./security-config.cjs');
const { createAdminAudit } = require('./admin-audit.cjs');
const { createAdminAuth } = require('./admin-auth.cjs');
const { createAdminService } = require('./admin-service.cjs');
const { createMerchantManagement } = require('./merchant-management.cjs');
const { createCustomerEngagement } = require('./customer-engagement.cjs');
const { createFinanceService } = require('./finance-service.cjs');

const db = createDatabase();
const { host, port } = serverConfig();
if (!db) throw new Error('Database configuration is required for application routes');
const checkDatabase = createDatabaseProbe(db);
const adminAudit = createAdminAudit(db);
const integrations = createIntegrationSettings({ db, audit: adminAudit });
// Storage remains bootstrap configuration; provider credentials are resolved per operation.
const paymentsConfig = paymentConfig(process.env, { storageOnly: true });
const storage = createSlipStorage(paymentsConfig);
let runtime;
const outbox = createNotificationOutbox({ db, messaging: { push: (...args) => runtime.messaging.push(...args) },
  publicAppUrl: process.env.APP_PUBLIC_URL || (process.env.LINE_LIFF_ID ? `https://liff.line.me/${process.env.LINE_LIFF_ID}` : 'http://127.0.0.1:3000') });
runtime = createIntegrationRuntime({ integrations, db, storage, storageConfig: paymentsConfig, notifier: outbox });
const auth = createCustomerAuth({
  db,
  config: customerAuthConfig(),
  resolveConfig: runtime.resolveCustomerConfig,
  identityProvider: createLineIdentityProvider(),
});
const staffAuth = createMerchantStaffAuth({ db, config: merchantStaffAuthConfig() });
const adminAuth = createAdminAuth({ db, audit: adminAudit });
const admins = createAdminService({
  db,
  audit: adminAudit,
  config: async () => {
    const e = await integrations.environment();
    return { lineChannelId: e.LINE_CHANNEL_ID, lineMessagingMode: e.LINE_MESSAGING_MODE,
      lineWebhookConfigured: e.LINE_WEBHOOK_ENABLED === 'true' && Boolean(e.LINE_WEBHOOK_SECRET || e.LINE_CHANNEL_SECRET),
      checkslipConfigured: Boolean(e.CHECKSLIP_API_KEY), paymentMode: e.PAYMENT_VERIFICATION_MODE, storageMode: paymentsConfig.storageMode };
  },
});
const idempotency = createPersistentIdempotencyStore({ db });
const lineWebhook = runtime.webhook;
const outboxWorker = startNotificationOutboxWorker(outbox);
const retentionWorker = startSlipRetentionWorker(createSlipRetention({ db, storage }));
const operationalRetentionTimer = setInterval(() => {
  Promise.allSettled([idempotency.pruneExpired(), lineWebhook?.pruneExpired()]);
}, 60 * 60 * 1000);
operationalRetentionTimer.unref();
const server = createApp({
  finance: createFinanceService(db, { integrations, audit: adminAudit, storage }),
  checkDatabase,
  auth,
  customers: createCustomerRepository(db),
  stores: createStoreRepository(db),
  orders: createOrderService(db),
  engagement: createCustomerEngagement(db),
  idempotency,
  payments: runtime.payments,
  staffAuth,
  management: createMerchantManagement({ db, storage, staffAuth }),
  merchantOrders: createMerchantOrderService(db, { notifier: outbox }),
  riderOrders: createRiderOrderService(db, { notifier: outbox }),
  lineWebhook,
  adminAuth,
  admins,
  integrations,
  storage,
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
