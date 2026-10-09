const express = require('express');
const multer = require('multer');
const { asyncRoute, HttpError, positiveId, textField } = require('./http.cjs');
const { detectImage } = require('./slip-storage.cjs');

function optionalText(value, name, max = 500) {
  return value === undefined ? undefined : textField(value, name, { max, nullable: true });
}
function boolean(value, name) {
  if (value === true || value === false) return value;
  throw new HttpError(400, 'invalid_request', `${name} must be boolean`);
}
function date(value, name, { nullable = false } = {}) {
  if ((value === null || value === '') && nullable) return null;
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.valueOf())) throw new HttpError(400, 'invalid_request', `${name} must be a valid date`);
  return parsed;
}
function number(value, name, { min = 0, nullable = false } = {}) {
  if ((value === null || value === '') && nullable) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw new HttpError(400, 'invalid_request', `${name} must be at least ${min}`);
  return parsed;
}
function enumValue(value, name, allowed) {
  if (!allowed.includes(value)) throw new HttpError(400, 'invalid_request', `${name} is invalid`);
  return value;
}

function createAdminRouter({ adminAuth, admins, integrations, checkDatabase, storage, maxUploadBytes = 5 * 1024 * 1024 }) {
  const router = express.Router();
  const requireAdmin = (permission, { csrf = false } = {}) => asyncRoute(async (req, _res, next) => {
    const session = await adminAuth.authenticate(req, { csrf });
    req.admin = session.admin;
    req.adminSessionToken = session.token;
    if (permission) adminAuth.requirePermission(req.admin, permission);
    next();
  });
  const context = (req) => ({ ip: req.ip, requestId: req.get('x-request-id') || null });

  router.post('/auth/login', asyncRoute(async (req, res) => {
    const session = await adminAuth.login(req.body?.username, req.body?.password, {
      ip: req.ip,
      userAgent: req.get('user-agent'),
      currentToken: adminAuth.sessionToken(req),
    });
    res.set('Set-Cookie', adminAuth.cookies(session.token, session.csrfToken)).json({ ok: true, admin: session.admin, csrf_token: session.csrfToken });
  }));
  router.get('/auth/me', requireAdmin(), (req, res) => res.json({ ok: true, admin: req.admin }));
  router.post('/auth/logout', requireAdmin(null, { csrf: true }), asyncRoute(async (req, res) => {
    await adminAuth.logout(req.adminSessionToken, req.admin, context(req));
    res.set('Set-Cookie', adminAuth.clearCookies()).status(204).end();
  }));

  router.get('/dashboard', requireAdmin('dashboard'), asyncRoute(async (_req, res) => res.json({ ok: true, ...(await admins.dashboard()) })));

  router.get('/merchants', requireAdmin('merchantsRead'), asyncRoute(async (req, res) => res.json({ ok: true, ...(await admins.listMerchants(req.query)) })));
  router.get('/merchants/:id', requireAdmin('merchantsRead'), asyncRoute(async (req, res) => res.json({ ok: true, merchant: await admins.merchantDetail(positiveId(req.params.id, 'merchantId')) })));
  router.post('/merchants/:id/suspend', requireAdmin('merchantsWrite', { csrf: true }), asyncRoute(async (req, res) => {
    const reason = textField(req.body?.reason, 'reason', { min: 3, max: 500 });
    res.json({ ok: true, merchant: await admins.setMerchantActive(req.admin, positiveId(req.params.id, 'merchantId'), false, reason, context(req)) });
  }));
  router.post('/merchants/:id/activate', requireAdmin('merchantsWrite', { csrf: true }), asyncRoute(async (req, res) => {
    res.json({ ok: true, merchant: await admins.setMerchantActive(req.admin, positiveId(req.params.id, 'merchantId'), true, null, context(req)) });
  }));

  router.get('/customers', requireAdmin('customersRead'), asyncRoute(async (req, res) => {
    const privileged = ['SUPER_ADMIN', 'ADMIN'].includes(req.admin.role);
    res.json({ ok: true, ...(await admins.listCustomers({ ...req.query, lineUserId: privileged ? req.query.line_user_id : undefined }, { includeLineUserId: privileged })) });
  }));
  router.get('/customers/:id', requireAdmin('customersRead'), asyncRoute(async (req, res) => {
    const privileged = ['SUPER_ADMIN', 'ADMIN'].includes(req.admin.role);
    res.json({ ok: true, customer: await admins.customerDetail(positiveId(req.params.id, 'customerId'), { includeLineUserId: privileged }) });
  }));
  router.patch('/customers/:id/status', requireAdmin('customersWrite', { csrf: true }), asyncRoute(async (req, res) => {
    res.json({ ok: true, customer: await admins.setCustomerActive(req.admin, positiveId(req.params.id, 'customerId'), boolean(req.body?.isActive, 'isActive'), context(req)) });
  }));

  router.get('/orders', requireAdmin('ordersRead'), asyncRoute(async (req, res) => res.json({ ok: true, ...(await admins.listOrders({ ...req.query, merchantId: req.query.merchant_id, customerId: req.query.customer_id, paymentStatus: req.query.payment_status })) })));
  router.get('/orders/:id', requireAdmin('ordersRead'), asyncRoute(async (req, res) => res.json({ ok: true, order: await admins.orderDetail(positiveId(req.params.id, 'orderId')) })));
  router.get('/payments', requireAdmin('paymentsRead'), asyncRoute(async (req, res) => res.json({ ok: true, ...(await admins.listPayments({ ...req.query, merchantId: req.query.merchant_id })) })));
  router.get('/payments/:id', requireAdmin('paymentsRead'), asyncRoute(async (req, res) => {
    const payment = await admins.paymentDetail(positiveId(req.params.id, 'paymentId'));
    if (req.admin.role === 'SUPPORT') {
      delete payment.slip;
      delete payment.verifications;
      delete payment.transaction_reference;
    }
    res.json({ ok: true, payment });
  }));

  router.get('/delivery-areas', requireAdmin('deliveryAreasWrite'), asyncRoute(async (req, res) => res.json({ ok: true, ...(await admins.listDeliveryAreas(req.query)) })));
  router.post('/delivery-areas/sois', requireAdmin('deliveryAreasWrite', { csrf: true }), asyncRoute(async (req, res) => {
    res.status(201).json({ ok: true, soi: await admins.saveSoi(req.admin, null, { name: textField(req.body?.name, 'name', { max: 160 }), is_active: req.body?.isActive === undefined ? true : boolean(req.body.isActive, 'isActive') }, context(req)) });
  }));
  router.patch('/delivery-areas/sois/:id', requireAdmin('deliveryAreasWrite', { csrf: true }), asyncRoute(async (req, res) => {
    const data = {};
    if (req.body?.name !== undefined) data.name = textField(req.body.name, 'name', { max: 160 });
    if (req.body?.isActive !== undefined) data.is_active = boolean(req.body.isActive, 'isActive');
    res.json({ ok: true, soi: await admins.saveSoi(req.admin, positiveId(req.params.id, 'soiId'), data, context(req)) });
  }));
  router.post('/delivery-areas/dormitories', requireAdmin('deliveryAreasWrite', { csrf: true }), asyncRoute(async (req, res) => {
    res.status(201).json({ ok: true, dormitory: await admins.saveDormitory(req.admin, null, {
      soi_id: positiveId(req.body?.soiId, 'soiId'), name: textField(req.body?.name, 'name', { max: 160 }),
      location_text: textField(req.body?.locationText, 'locationText', { max: 500 }), is_active: req.body?.isActive === undefined ? true : boolean(req.body.isActive, 'isActive'),
    }, context(req)) });
  }));
  router.patch('/delivery-areas/dormitories/:id', requireAdmin('deliveryAreasWrite', { csrf: true }), asyncRoute(async (req, res) => {
    const data = {};
    if (req.body?.name !== undefined) data.name = textField(req.body.name, 'name', { max: 160 });
    if (req.body?.locationText !== undefined) data.location_text = textField(req.body.locationText, 'locationText', { max: 500 });
    if (req.body?.isActive !== undefined) data.is_active = boolean(req.body.isActive, 'isActive');
    res.json({ ok: true, dormitory: await admins.saveDormitory(req.admin, positiveId(req.params.id, 'dormitoryId'), data, context(req)) });
  }));

  function bannerPayload(body, partial = false) {
    const data = {};
    if (!partial || body.title !== undefined) data.title = textField(body.title, 'title', { max: 200 });
    if (!partial || body.imageObjectKey !== undefined) {
      data.image_object_key = textField(body.imageObjectKey, 'imageObjectKey', { max: 500 });
      if (!/^banners\/\d{4}\/\d{2}\/[0-9a-f-]+\.(?:png|jpg|webp)$/i.test(data.image_object_key)) {
        throw new HttpError(400, 'invalid_banner_object_key', 'imageObjectKey ต้องมาจาก banner upload');
      }
    }
    if (!partial || body.scope !== undefined) data.scope = enumValue(body.scope, 'scope', ['GLOBAL', 'MERCHANT']);
    if (!partial || body.merchantId !== undefined) data.merchant_id = body.merchantId === null ? null : positiveId(body.merchantId, 'merchantId');
    if (!partial || body.targetType !== undefined) data.target_type = enumValue(body.targetType, 'targetType', ['NONE', 'STORE', 'MENU', 'URL', 'PROMOTION']);
    if (!partial || body.targetValue !== undefined) data.target_value = optionalText(body.targetValue, 'targetValue');
    if (!partial || body.status !== undefined) data.status = enumValue(body.status, 'status', ['DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED']);
    if (!partial || body.startsAt !== undefined) data.starts_at = date(body.startsAt, 'startsAt', { nullable: true });
    if (!partial || body.endsAt !== undefined) data.ends_at = date(body.endsAt, 'endsAt', { nullable: true });
    if (!partial || body.sortOrder !== undefined) data.sort_order = number(body.sortOrder ?? 0, 'sortOrder');
    return data;
  }
  router.get('/banners', requireAdmin('contentWrite'), asyncRoute(async (req, res) => res.json({ ok: true, ...(await admins.listBanners(req.query)) })));
  router.get('/banners/:id/image', requireAdmin('contentWrite'), asyncRoute(async (req, res) => {
    if (!storage?.read) throw new HttpError(503, 'banner_storage_unavailable', 'ไม่สามารถโหลดรูปแบนเนอร์');
    const image = await storage.read(await admins.bannerObjectKey(positiveId(req.params.id, 'bannerId')));
    res.set({ 'Content-Type': image.contentType, 'Cache-Control': 'private, max-age=60', 'Content-Length': image.buffer.length }).send(image.buffer);
  }));
  if (storage) {
    const bannerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes, files: 1, fields: 0 } }).single('image');
    router.post('/banners/upload', requireAdmin('contentWrite', { csrf: true }), bannerUpload, asyncRoute(async (req, res) => {
      if (!req.file) throw new HttpError(400, 'banner_image_required', 'กรุณาเลือกรูปแบนเนอร์');
      if (detectImage(req.file.buffer)?.contentType !== req.file.mimetype) throw new HttpError(400, 'invalid_banner_image', 'รองรับเฉพาะ PNG, JPEG หรือ WebP');
      const result = await storage.put({ buffer: req.file.buffer, contentType: req.file.mimetype, namespace: 'banners' });
      res.status(201).json({ ok: true, object_key: result.objectKey });
    }));
  }
  router.post('/banners', requireAdmin('contentWrite', { csrf: true }), asyncRoute(async (req, res) => res.status(201).json({ ok: true, banner: await admins.saveBanner(req.admin, null, bannerPayload(req.body || {}), context(req)) })));
  router.patch('/banners/:id', requireAdmin('contentWrite', { csrf: true }), asyncRoute(async (req, res) => res.json({ ok: true, banner: await admins.saveBanner(req.admin, positiveId(req.params.id, 'bannerId'), bannerPayload(req.body || {}, true), context(req)) })));

  function promotionPayload(body, partial = false) {
    const data = {};
    if (!partial || body.fundingSource !== undefined) data.funding_source = enumValue(body.fundingSource, 'fundingSource', ['MERCHANT','PLATFORM']);
    if (!partial || body.name !== undefined) data.name = textField(body.name, 'name', { max: 200 });
    if (!partial || body.description !== undefined) data.description = optionalText(body.description, 'description', 2000);
    if (!partial || body.merchantId !== undefined) data.merchant_id = body.merchantId === null ? null : positiveId(body.merchantId, 'merchantId');
    if (!partial || body.promotionType !== undefined) data.promotion_type = enumValue(body.promotionType, 'promotionType', ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY']);
    if (!partial || body.value !== undefined) data.value = number(body.value, 'value');
    if (!partial || body.minimumOrderAmount !== undefined) data.minimum_order_amount = number(body.minimumOrderAmount ?? 0, 'minimumOrderAmount');
    if (!partial || body.maximumDiscountAmount !== undefined) data.maximum_discount_amount = number(body.maximumDiscountAmount, 'maximumDiscountAmount', { nullable: true });
    if (!partial || body.startsAt !== undefined) data.starts_at = date(body.startsAt, 'startsAt');
    if (!partial || body.endsAt !== undefined) data.ends_at = date(body.endsAt, 'endsAt');
    if (!partial || body.usageLimit !== undefined) data.usage_limit = number(body.usageLimit, 'usageLimit', { min: 1, nullable: true });
    if (!partial || body.isActive !== undefined) data.is_active = body.isActive === undefined ? true : boolean(body.isActive, 'isActive');
    return data;
  }
  router.get('/promotions', requireAdmin('contentWrite'), asyncRoute(async (req, res) => res.json({ ok: true, ...(await admins.listPromotions(req.query)) })));
  router.post('/promotions', requireAdmin('contentWrite', { csrf: true }), asyncRoute(async (req, res) => res.status(201).json({ ok: true, promotion: await admins.savePromotion(req.admin, null, promotionPayload(req.body || {}), context(req)) })));
  router.patch('/promotions/:id', requireAdmin('contentWrite', { csrf: true }), asyncRoute(async (req, res) => res.json({ ok: true, promotion: await admins.savePromotion(req.admin, positiveId(req.params.id, 'promotionId'), promotionPayload(req.body || {}, true), context(req)) })));

  router.get('/reviews', requireAdmin('contentWrite'), asyncRoute(async (req, res) => res.json({ ok: true, ...(await admins.listReviews(req.query)) })));
  router.patch('/reviews/:id', requireAdmin('contentWrite', { csrf: true }), asyncRoute(async (req, res) => {
    const status = enumValue(req.body?.status, 'status', ['PUBLISHED', 'HIDDEN']);
    res.json({ ok: true, review: await admins.setReviewStatus(req.admin, positiveId(req.params.id, 'reviewId'), status, context(req)) });
  }));

  function couponPayload(body, partial = false) {
    const data = {};
    if (!partial || body.fundingSource !== undefined) data.funding_source = enumValue(body.fundingSource, 'fundingSource', ['MERCHANT','PLATFORM']);
    if (!partial || body.code !== undefined) data.code = textField(body.code, 'code', { min: 3, max: 64 });
    if (!partial || body.name !== undefined) data.name = textField(body.name, 'name', { max: 200 });
    if (!partial || body.description !== undefined) data.description = optionalText(body.description, 'description', 2000);
    if (!partial || body.merchantId !== undefined) data.merchant_id = body.merchantId === null || body.merchantId === '' ? null : positiveId(body.merchantId, 'merchantId');
    if (!partial || body.promotionType !== undefined) data.promotion_type = enumValue(body.promotionType, 'promotionType', ['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_DELIVERY']);
    if (!partial || body.value !== undefined) data.value = number(body.value, 'value');
    if (!partial || body.minimumOrderAmount !== undefined) data.minimum_order_amount = number(body.minimumOrderAmount ?? 0, 'minimumOrderAmount');
    if (!partial || body.maximumDiscountAmount !== undefined) data.maximum_discount_amount = number(body.maximumDiscountAmount, 'maximumDiscountAmount', { nullable: true });
    if (!partial || body.startsAt !== undefined) data.starts_at = date(body.startsAt, 'startsAt');
    if (!partial || body.endsAt !== undefined) data.ends_at = date(body.endsAt, 'endsAt');
    if (!partial || body.usageLimit !== undefined) data.usage_limit = number(body.usageLimit, 'usageLimit', { min: 1, nullable: true });
    if (!partial || body.perCustomerLimit !== undefined) data.per_customer_limit = number(body.perCustomerLimit, 'perCustomerLimit', { min: 1, nullable: true });
    if (!partial || body.isActive !== undefined) data.is_active = body.isActive === undefined ? true : boolean(body.isActive, 'isActive');
    return data;
  }
  router.get('/coupons', requireAdmin('contentWrite'), asyncRoute(async (req, res) => res.json({ ok: true, ...(await admins.listCoupons(req.query)) })));
  router.post('/coupons', requireAdmin('contentWrite', { csrf: true }), asyncRoute(async (req, res) => res.status(201).json({ ok: true, coupon: await admins.saveCoupon(req.admin, null, couponPayload(req.body || {}), context(req)) })));
  router.patch('/coupons/:id', requireAdmin('contentWrite', { csrf: true }), asyncRoute(async (req, res) => res.json({ ok: true, coupon: await admins.saveCoupon(req.admin, positiveId(req.params.id, 'couponId'), couponPayload(req.body || {}, true), context(req)) })));

  router.get('/users', requireAdmin('adminUsersWrite'), asyncRoute(async (req, res) => {
    const result = await admins.listAdmins(req.query);
    res.json({ ok: true, admins: result.items, ...result });
  }));
  router.post('/users', requireAdmin('adminUsersWrite', { csrf: true }), asyncRoute(async (req, res) => {
    const data = {
      username: textField(req.body?.username, 'username', { min: 3, max: 80 }), password: textField(req.body?.password, 'password', { min: 12, max: 200 }),
      full_name: textField(req.body?.fullName, 'fullName', { max: 160 }), email: optionalText(req.body?.email, 'email', 254),
      role: enumValue(req.body?.role, 'role', ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'FINANCE']), is_active: true,
    };
    if (!/^[a-zA-Z0-9_.-]{3,80}$/.test(data.username)) throw new HttpError(400, 'invalid_admin_username', 'Username ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ . -');
    if (req.body?.isActive !== undefined) data.is_active = boolean(req.body.isActive, 'isActive');
    res.status(201).json({ ok: true, admin: await admins.saveAdmin(req.admin, null, data, context(req)) });
  }));
  router.patch('/users/:id', requireAdmin('adminUsersWrite', { csrf: true }), asyncRoute(async (req, res) => {
    const data = {};
    if (req.body?.fullName !== undefined) data.full_name = textField(req.body.fullName, 'fullName', { max: 160 });
    if (req.body?.email !== undefined) data.email = optionalText(req.body.email, 'email', 254);
    if (req.body?.role !== undefined) data.role = enumValue(req.body.role, 'role', ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'FINANCE']);
    if (req.body?.isActive !== undefined) data.is_active = boolean(req.body.isActive, 'isActive');
    if (req.body?.password !== undefined) data.password = textField(req.body.password, 'password', { min: 12, max: 200 });
    res.json({ ok: true, admin: await admins.saveAdmin(req.admin, positiveId(req.params.id, 'adminId'), data, context(req)) });
  }));

  router.get('/audit-logs', requireAdmin('auditRead'), asyncRoute(async (req, res) => {
    const result = await admins.listAudit({ ...req.query, actorId: req.admin.role === 'SUPPORT' ? req.admin.id : req.query.actor_id });
    if (req.admin.role === 'SUPPORT') result.items = result.items.map(({ metadata, ip_address, ...item }) => { void metadata; void ip_address; return item; });
    res.json({ ok: true, ...result });
  }));
  router.get('/system-status', requireAdmin('systemStatusRead'), asyncRoute(async (_req, res) => res.json({ ok: true, status: await admins.systemStatus(checkDatabase) })));
  if (integrations) {
    router.use('/merchants/:id/payment-recipient', (_req, res, next) => { res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }); next(); });
    router.get('/merchants/:id/payment-recipient', requireAdmin('settingsWrite'), asyncRoute(async (req, res) =>
      res.json(await integrations.recipients.get(positiveId(req.params.id, 'merchantId')))));
    router.patch('/merchants/:id/payment-recipient', requireAdmin('settingsWrite', { csrf: true }), asyncRoute(async (req, res) =>
      res.json(await integrations.recipients.update(req.admin, positiveId(req.params.id, 'merchantId'), req.body, { ip: req.ip }))));
    router.use('/settings/integrations', (_req, res, next) => { res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }); next(); });
    router.post('/settings/integrations/secrets/:key/reveal', requireAdmin('settingsWrite', { csrf: true }), asyncRoute(async (req, res) => {
      const password = req.body?.password;
      if (req.body) delete req.body.password;
      await adminAuth.reauthenticateForSecret(req.admin, password);
      res.json(await integrations.reveal(req.admin, req.params.key, { ip: req.ip }));
    }));
    router.get('/settings/integrations', requireAdmin('settingsWrite'), asyncRoute(async (_req, res) => res.json(await integrations.get())));
    router.patch('/settings/integrations', requireAdmin('settingsWrite', { csrf: true }), asyncRoute(async (req, res) => res.json(await integrations.update(req.admin, req.body, context(req)))));
    router.post('/settings/integrations/test', requireAdmin('settingsWrite', { csrf: true }), asyncRoute(async (req, res) => res.json(await integrations.testConfiguration(req.admin, context(req)))));
    router.post('/settings/integrations/test-easyslip', requireAdmin('settingsWrite', { csrf: true }), asyncRoute(async (req, res) => res.json(await integrations.testEasyslip(req.admin, req.body, context(req)))));
  }
  router.get('/settings', requireAdmin('settingsWrite'), asyncRoute(async (_req, res) => res.json({ ok: true, settings: await admins.settings() })));
  router.put('/settings/:key', requireAdmin('settingsWrite', { csrf: true }), asyncRoute(async (req, res) => res.json({ ok: true, setting: await admins.saveSetting(req.admin, req.params.key, req.body?.value, req.body?.isPublic === true, context(req)) })));
  router.get('/reports', requireAdmin('reportsRead'), asyncRoute(async (_req, res) => res.json({ ok: true, ...(await admins.reports()) })));

  return router;
}

module.exports = { createAdminRouter };
