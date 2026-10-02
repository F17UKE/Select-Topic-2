const express = require('express');
const multer = require('multer');
const { asyncRoute, HttpError, positiveId, textField } = require('./http.cjs');

function addressPayload(body, { partial = false } = {}) {
  const fields = {};
  if (!partial || body.dormitoryId !== undefined) fields.dormitory_id = positiveId(body.dormitoryId, 'dormitoryId');
  if (!partial || body.label !== undefined) fields.label = textField(body.label, 'label', { max: 80 });
  if (!partial || body.roomNumber !== undefined) fields.room_number = textField(body.roomNumber, 'roomNumber', { max: 80 });
  if (!partial || body.contactPhone !== undefined) fields.contact_phone = textField(body.contactPhone, 'contactPhone', { min: 8, max: 32 });
  if (!partial || body.addressDetail !== undefined) {
    fields.address_detail = textField(body.addressDetail, 'addressDetail', { max: 1000, nullable: true });
  }
  if (partial && !Object.keys(fields).length) throw new HttpError(400, 'invalid_request', 'No address fields supplied');
  return fields;
}

function createApp({ checkDatabase, auth, customers, stores, orders, idempotency, payments, staffAuth, merchantOrders, riderOrders, lineWebhook, security = {} }) {
  const app = express();
  app.disable('x-powered-by');
  if (security.trustProxyHops) app.set('trust proxy', security.trustProxyHops);
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    if (security.production && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const origin = req.get('origin');
    if (origin && security.allowedOrigin && origin !== security.allowedOrigin) {
      return res.status(403).json({ error: 'origin_not_allowed' });
    }
    next();
  });

  if (lineWebhook) {
    const webhookBody = express.raw({ type: 'application/json', limit: '256kb' });
    const webhookRoute = asyncRoute(async (req, res) => {
      const result = await lineWebhook.handle(req.body, req.get('x-line-signature'));
      res.json(result);
    });
    app.post('/api/webhooks/line', webhookBody, webhookRoute);
    app.post('/webhooks/line', webhookBody, webhookRoute);
  }
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (_req, res) => {
    let database;
    try { database = await checkDatabase(); }
    catch { database = { status: 'unavailable' }; }
    const ready = database.status === 'ok';
    res.set('Cache-Control', 'no-store').status(ready ? 200 : 503).json({
      status: ready ? 'ok' : 'degraded', api: { status: 'ok' }, database,
    });
  });

  if (auth && customers && stores) {
    const requireCustomer = asyncRoute(async (req, _res, next) => {
      const session = await auth.authenticate(req);
      req.customer = session.customer;
      req.customerSessionToken = session.token;
      next();
    });

    app.get('/api/auth/config', (_req, res) => {
      res.json({
        mode: auth.config.mode,
        dev_login_enabled: auth.config.devLoginEnabled,
        liff_id: auth.config.mode === 'line' ? auth.config.liffId : null,
      });
    });

    app.post('/api/dev/auth/login', asyncRoute(async (_req, res) => {
      const session = await auth.loginDevelopmentCustomer();
      res.set('Set-Cookie', auth.cookie(session.token)).json({ customer: session.customer });
    }));

    app.post('/api/auth/line', asyncRoute(async (req, res) => {
      const session = await auth.loginLineCustomer(req.body?.idToken);
      res.set('Set-Cookie', auth.cookie(session.token)).json({
        customer: session.customer,
        onboarding_required: session.onboarding_required,
      });
    }));

    app.get('/api/auth/me', requireCustomer, (req, res) => res.json({ customer: req.customer }));

    app.post('/api/auth/logout', requireCustomer, (req, res) => {
      auth.logout(req.customerSessionToken);
      res.set('Set-Cookie', auth.clearCookie()).status(204).end();
    });

    app.get('/api/customer/profile', requireCustomer, asyncRoute(async (req, res) => {
      res.json({ customer: await customers.getProfile(req.customer.id) });
    }));

    app.patch('/api/customer/profile', requireCustomer, asyncRoute(async (req, res) => {
      const changes = {};
      if (req.body.displayName !== undefined) changes.display_name = textField(req.body.displayName, 'displayName', { max: 160 });
      if (req.body.phone !== undefined) changes.phone = textField(req.body.phone, 'phone', { min: 8, max: 32, nullable: true });
      if (!Object.keys(changes).length) throw new HttpError(400, 'invalid_request', 'No profile fields supplied');
      res.json({ customer: await customers.updateProfile(req.customer.id, changes) });
    }));

    app.get('/api/dormitories', requireCustomer, asyncRoute(async (_req, res) => {
      res.json({ dormitories: await customers.listDormitories() });
    }));

    app.get('/api/customer/addresses', requireCustomer, asyncRoute(async (req, res) => {
      res.json({ addresses: await customers.listAddresses(req.customer.id) });
    }));

    app.post('/api/customer/addresses', requireCustomer, asyncRoute(async (req, res) => {
      const id = await customers.addAddress(req.customer.id, addressPayload(req.body), req.body.isDefault === true);
      const addresses = await customers.listAddresses(req.customer.id);
      res.status(201).json({ address: addresses.find((address) => address.id === id) });
    }));

    app.patch('/api/customer/addresses/:id', requireCustomer, asyncRoute(async (req, res) => {
      const id = positiveId(req.params.id, 'addressId');
      await customers.updateAddress(req.customer.id, id, addressPayload(req.body, { partial: true }));
      const addresses = await customers.listAddresses(req.customer.id);
      res.json({ address: addresses.find((address) => address.id === id) });
    }));

    app.put('/api/customer/addresses/:id/default', requireCustomer, asyncRoute(async (req, res) => {
      const id = positiveId(req.params.id, 'addressId');
      await customers.setDefaultAddress(req.customer.id, id);
      res.json({ addresses: await customers.listAddresses(req.customer.id) });
    }));

    app.get('/api/merchants', requireCustomer, asyncRoute(async (req, res) => {
      const addressId = req.query.addressId === undefined ? null : positiveId(req.query.addressId, 'addressId');
      const search = req.query.q === undefined || req.query.q === '' ? null : textField(req.query.q, 'q', { max: 80 });
      const merchants = await stores.listMerchants({ customerId: req.customer.id, addressId, search });
      res.json({ merchants, query: search });
    }));

    app.get('/api/merchants/:id', requireCustomer, asyncRoute(async (req, res) => {
      const addressId = req.query.addressId === undefined ? null : positiveId(req.query.addressId, 'addressId');
      const merchant = await stores.merchantById({
        customerId: req.customer.id,
        merchantId: positiveId(req.params.id, 'merchantId'),
        addressId,
      });
      res.json({ merchant });
    }));

    app.get('/api/merchants/:id/menu', requireCustomer, asyncRoute(async (req, res) => {
      const merchantId = positiveId(req.params.id, 'merchantId');
      await stores.merchantById({ customerId: req.customer.id, merchantId, addressId: null });
      res.json({ categories: await stores.menuForMerchant(merchantId) });
    }));

    app.get('/api/menu-items/:id', requireCustomer, asyncRoute(async (req, res) => {
      res.json({ menu_item: await stores.menuItemById(positiveId(req.params.id, 'menuItemId')) });
    }));

    if (orders && idempotency) {
      app.post('/api/orders', requireCustomer, asyncRoute(async (req, res) => {
        const result = await idempotency.execute({
          scope: `customer:${req.customer.id}:orders`,
          key: req.get('idempotency-key'),
          payload: req.body,
          operation: (trx) => orders.createOrder(req.customer.id, req.body, { transaction: trx }),
          responseStatus: 201,
        });
        res.set('Idempotency-Replayed', result.replayed ? 'true' : 'false')
          .status(result.status || 201).json({ order: result.value });
      }));

      app.get('/api/orders', requireCustomer, asyncRoute(async (req, res) => {
        res.json({ orders: await orders.listOrders(req.customer.id) });
      }));

      app.get('/api/orders/:id', requireCustomer, asyncRoute(async (req, res) => {
        res.json({ order: await orders.getOrder(req.customer.id, positiveId(req.params.id, 'orderId')) });
      }));

      if (payments) {
        const slipUpload = multer({
          storage: multer.memoryStorage(),
          limits: { fileSize: payments.maxUploadBytes, files: 1, fields: 4 },
        }).single('slip');

        app.post('/api/orders/:id/payments', requireCustomer, asyncRoute(async (req, res) => {
          const result = await payments.createAttempt(req.customer.id, positiveId(req.params.id, 'orderId'));
          res.status(201).json(result);
        }));

        app.get('/api/orders/:id/payment', requireCustomer, asyncRoute(async (req, res) => {
          res.json(await payments.getPayment(req.customer.id, positiveId(req.params.id, 'orderId')));
        }));

        app.get('/api/orders/:id/payment/qr', requireCustomer, asyncRoute(async (req, res) => {
          res.json({ qr: await payments.getQr(req.customer.id, positiveId(req.params.id, 'orderId')) });
        }));

        app.post('/api/orders/:id/payment/slip', requireCustomer, slipUpload, asyncRoute(async (req, res) => {
          const result = await payments.uploadAndVerify(
            req.customer.id,
            positiveId(req.params.id, 'orderId'),
            req.file,
            req.body,
          );
          res.json(result);
        }));
      }
    }
  }

  if (staffAuth && merchantOrders) {
    const requireStaff = asyncRoute(async (req, _res, next) => {
      const session = await staffAuth.authenticate(req);
      req.staff = session.staff;
      req.staffSessionToken = session.token;
      next();
    });

    app.get('/api/merchant/auth/config', (_req, res) => {
      res.json({ mode: staffAuth.config.mode, dev_login_enabled: staffAuth.config.devLoginEnabled });
    });

    app.post('/api/dev/merchant/auth/login', asyncRoute(async (req, res) => {
      const session = await staffAuth.loginDevelopmentStaff(req.body?.username);
      res.set('Set-Cookie', staffAuth.cookie(session.token)).json({ staff: session.staff });
    }));

    app.post('/api/merchant/auth/login', asyncRoute(async (req, res) => {
      const session = await staffAuth.loginPassword(req.body?.username, req.body?.password, {
        ip: req.ip, currentToken: staffAuth.sessionToken(req),
      });
      res.set('Set-Cookie', staffAuth.cookie(session.token)).json({ staff: session.staff });
    }));

    app.get('/api/merchant/auth/me', requireStaff, (req, res) => res.json({ staff: req.staff }));
    app.post('/api/merchant/auth/logout', requireStaff, (req, res) => {
      staffAuth.logout(req.staffSessionToken);
      res.set('Set-Cookie', staffAuth.clearCookie()).status(204).end();
    });

    app.get('/api/merchant/orders', requireStaff, asyncRoute(async (req, res) => {
      res.json({ orders: await merchantOrders.listOrders(req.staff) });
    }));
    app.get('/api/merchant/riders', requireStaff, asyncRoute(async (req, res) => {
      res.json({ riders: await merchantOrders.listRiders(req.staff) });
    }));
    app.get('/api/merchant/orders/:id', requireStaff, asyncRoute(async (req, res) => {
      res.json({ order: await merchantOrders.getOrder(req.staff, positiveId(req.params.id, 'orderId')) });
    }));
    app.post('/api/merchant/orders/:id/accept', requireStaff, asyncRoute(async (req, res) => {
      res.json(await merchantOrders.accept(req.staff, positiveId(req.params.id, 'orderId')));
    }));
    app.post('/api/merchant/orders/:id/reject', requireStaff, asyncRoute(async (req, res) => {
      if (req.body?.reason !== undefined) {
        throw new HttpError(422, 'reject_reason_not_supported', 'Schema V3 has no reject_reason column');
      }
      res.json(await merchantOrders.reject(req.staff, positiveId(req.params.id, 'orderId')));
    }));
    app.post('/api/merchant/orders/:id/start-preparing', requireStaff, asyncRoute(async (req, res) => {
      res.json(await merchantOrders.startPreparing(req.staff, positiveId(req.params.id, 'orderId')));
    }));
    app.post('/api/merchant/orders/:id/ready', requireStaff, asyncRoute(async (req, res) => {
      res.json(await merchantOrders.ready(req.staff, positiveId(req.params.id, 'orderId')));
    }));
    app.patch('/api/merchant/orders/:orderId/items/:itemId', requireStaff, asyncRoute(async (req, res) => {
      res.json({ order: await merchantOrders.markItem(
        req.staff,
        positiveId(req.params.orderId, 'orderId'),
        positiveId(req.params.itemId, 'itemId'),
        req.body?.completed,
      ) });
    }));
    app.post('/api/merchant/orders/:id/complete-all-items', requireStaff, asyncRoute(async (req, res) => {
      res.json({ order: await merchantOrders.completeAllItems(req.staff, positiveId(req.params.id, 'orderId')) });
    }));
    app.post('/api/merchant/orders/:id/assign-rider', requireStaff, asyncRoute(async (req, res) => {
      res.json({ order: await merchantOrders.assignRider(
        req.staff,
        positiveId(req.params.id, 'orderId'),
        positiveId(req.body?.riderId, 'riderId'),
      ) });
    }));
    app.post('/api/merchant/orders/:id/unassign-rider', requireStaff, asyncRoute(async (req, res) => {
      res.json({ order: await merchantOrders.unassignRider(req.staff, positiveId(req.params.id, 'orderId')) });
    }));

    if (riderOrders) {
      app.get('/api/rider/orders', requireStaff, asyncRoute(async (req, res) => {
        res.json({ orders: await riderOrders.listOrders(req.staff) });
      }));
      app.get('/api/rider/orders/:id', requireStaff, asyncRoute(async (req, res) => {
        res.json({ order: await riderOrders.getOrder(req.staff, positiveId(req.params.id, 'orderId')) });
      }));
      app.post('/api/rider/orders/:id/start-delivery', requireStaff, asyncRoute(async (req, res) => {
        res.json({ order: await riderOrders.startDelivery(req.staff, positiveId(req.params.id, 'orderId')) });
      }));
      app.post('/api/rider/orders/:id/complete', requireStaff, asyncRoute(async (req, res) => {
        res.json({ order: await riderOrders.complete(req.staff, positiveId(req.params.id, 'orderId')) });
      }));
    }
  }

  app.all(['/api/webhooks/line', '/webhooks/line'], (_req, res) => {
    res.status(501).json({ error: 'line_webhook_not_implemented' });
  });
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((error, _req, res, next) => {
    void next;
    if (error instanceof HttpError) {
      const body = { error: error.code, message: error.message };
      if (error.details) body.details = error.details;
      return res.status(error.status).json(body);
    }
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'slip_too_large' });
      return res.status(400).json({ error: 'invalid_upload', message: error.code });
    }
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
    console.error('Unhandled request error', { code: error?.code || 'internal_error' });
    return res.status(500).json({ error: 'internal_error' });
  });
  return app;
}

module.exports = { createApp };
