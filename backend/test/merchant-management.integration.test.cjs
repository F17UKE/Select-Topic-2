const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
require('../src/env.cjs');
const { createDatabase, createDatabaseProbe } = require('../src/database.cjs');
const { createMerchantManagement } = require('../src/merchant-management.cjs');
const { createMerchantStaffAuth } = require('../src/staff-auth.cjs');
const { createMerchantOrderService } = require('../src/merchant-order-service.cjs');
const { createApp } = require('../src/app.cjs');
test(
  'merchant management milestones',
  { skip: process.env.DB_HOST !== '127.0.0.1' || process.env.DB_NAME !== 'select_topic_2_local' },
  async (t) => {
    const db = createDatabase(process.env, { required: true });
    const trx = await db.transaction();
    const staffAuth = createMerchantStaffAuth({
      db: trx,
      config: { mode: 'mock', devLoginEnabled: true, defaultUsername: 'local_manager', secureCookie: false },
    });
    const storage = {
      put: async ({ namespace, merchantId }) => ({
        objectKey: namespace + '/' + merchantId + '/12345678-1234-4123-8123-123456789abc.png',
      }),
      read: async () => ({ buffer: Buffer.from('image'), contentType: 'image/png' }),
    };
    const management = createMerchantManagement({ db: trx, staffAuth, storage });
    const app = createApp({
      checkDatabase: createDatabaseProbe(trx),
      staffAuth,
      merchantOrders: createMerchantOrderService(trx),
      management,
    });
    const manager = request.agent(app),
      cashier = request.agent(app),
      kitchen = request.agent(app),
      rider = request.agent(app);
    try {
      for (const [agent, username] of [
        [manager, 'local_manager'],
        [cashier, 'local_cashier'],
        [kitchen, 'local_kitchen'],
        [rider, 'local_rider'],
      ])
        await agent.post('/api/dev/merchant/auth/login').send({ username }).expect(200);
      await t.test('G1 dashboard RBAC and SQL aggregates', async () => {
        const result = await manager.get('/api/merchant/management/dashboard').expect(200);
        assert.ok(result.body.metrics);
        assert.ok(result.body.definition.includes('Asia/Bangkok'));
        await cashier.get('/api/merchant/management/dashboard').expect(200);
        assert.equal(
          (await kitchen.get('/api/merchant/management/dashboard').expect(200)).body.metrics.revenue_today,
          undefined,
        );
        await rider.get('/api/merchant/management/dashboard').expect(403);
      });
      await t.test('G2 store settings, masked PromptPay, schedule and image isolation', async () => {
        const path = '/api/merchant/management';
        const result = await manager.get(path + '/store').expect(200);
        assert.equal(result.body.store.promptpay_id, undefined);
        await cashier
          .patch(path + '/store')
          .set('X-Merchant-Request', '1')
          .send({ is_open: false })
          .expect(403);
        await manager
          .patch(path + '/store')
          .send({ is_open: false })
          .expect(403);
        await manager
          .patch(path + '/store')
          .set('X-Merchant-Request', '1')
          .send({ store_name: 'Local Kitchen G2', merchant_id: 2 })
          .expect(200);
        assert.notEqual((await trx('merchants').where({ id: 2 }).first()).store_name, 'Local Kitchen G2');
        await manager
          .patch(path + '/store')
          .set('X-Merchant-Request', '1')
          .send({ promptpay_id: 'bad', promptpay_identifier_type: 'PHONE' })
          .expect(400);
        await manager
          .put(path + '/store/hours')
          .set('X-Merchant-Request', '1')
          .send({ hours: Array.from({ length: 7 }, (_, day_of_week) => ({ day_of_week, is_closed: true })) })
          .expect(200);
        const { createStoreRepository } = require('../src/store-repository.cjs');
        assert.equal(
          (await createStoreRepository(trx).merchantById({ customerId: 1, merchantId: 1 })).opening_status,
          'CLOSED',
        );
        await manager
          .put(path + '/store/hours')
          .set('X-Merchant-Request', '1')
          .send({ hours: [] })
          .expect(200);
        await manager
          .post(path + '/store/gallery')
          .set('X-Merchant-Request', '1')
          .send({ image_url: '/api/catalog/images/merchant/2/12345678-1234-4123-8123-123456789abc.png' })
          .expect(400);
        await manager
          .post(path + '/images/merchant')
          .set('X-Merchant-Request', '1')
          .attach('image', Buffer.from('bad'), 'bad.png')
          .expect(400);
      });
      await t.test(
        'catalog upload, primary gallery, public delivery and private slip isolation',
        async () => {
          const base = '/api/merchant/management';
          const upload = (
            await manager
              .post(base + '/images/merchant')
              .set('X-Merchant-Request', '1')
              .attach('image', Buffer.from('89504e470d0a1a0a', 'hex'), {
                filename: 'unsafe-original-name.png',
                contentType: 'image/png',
              })
              .expect(201)
          ).body;
          assert.match(upload.image_url, /^\/api\/catalog\/images\/merchant\/1\//);
          const saved = (
            await manager
              .post(base + '/store/gallery')
              .set('X-Merchant-Request', '1')
              .send({ ...upload, is_primary: true, sort_order: 10 })
              .expect(201)
          ).body;
          assert.equal((await trx('merchant_images').where({ merchant_id: 1, is_primary: true })).length, 1);
          await request(app).get(upload.image_url).expect(200);
          await request(app)
            .get('/api/catalog/images/slips/1/12345678-1234-4123-8123-123456789abc.png')
            .expect(404);
          const other = await trx('merchant_images').where({ merchant_id: 2 }).first();
          await manager
            .delete(base + '/store/gallery/' + other.id)
            .set('X-Merchant-Request', '1')
            .expect(404);
          await manager
            .delete(base + '/store/gallery/' + saved.id)
            .set('X-Merchant-Request', '1')
            .expect(200);
          await request(app).get(upload.image_url).expect(404);
        },
      );
      await t.test('G3 categories CRUD duplicate and ownership', async () => {
        const path = '/api/merchant/management/categories';
        const create = await manager
          .post(path)
          .set('X-Merchant-Request', '1')
          .send({ name: 'G3 category' })
          .expect(201);
        await manager.post(path).set('X-Merchant-Request', '1').send({ name: 'G3 category' }).expect(409);
        const other = await trx('menu_categories').where({ merchant_id: 2 }).first();
        await manager
          .patch(path + '/' + other.id)
          .set('X-Merchant-Request', '1')
          .send({ name: 'bad' })
          .expect(404);
        await manager
          .patch(path + '/' + create.body.id)
          .set('X-Merchant-Request', '1')
          .send({ is_active: false, sort_order: 2 })
          .expect(200);
        await manager
          .delete(path + '/' + create.body.id)
          .set('X-Merchant-Request', '1')
          .expect(200);
        assert.ok((await trx('menu_categories').where({ id: create.body.id }).first()).deleted_at);
        await kitchen.post(path).set('X-Merchant-Request', '1').send({ name: 'forbidden' }).expect(403);
      });
      await t.test('G4 menu CRUD validation and category isolation', async () => {
        const path = '/api/merchant/management/menu',
          category = await trx('menu_categories').where({ merchant_id: 1 }).whereNull('deleted_at').first(),
          other = await trx('menu_categories').where({ merchant_id: 2 }).first();
        for (const body of [
          { name: 'bad', category_id: category.id, price: -1 },
          { name: 'bad', category_id: category.id, price: 10, stock_quantity: -1 },
        ])
          await manager.post(path).set('X-Merchant-Request', '1').send(body).expect(400);
        await manager
          .post(path)
          .set('X-Merchant-Request', '1')
          .send({ name: 'bad', category_id: other.id, price: 10 })
          .expect(404);
        const created = await manager
          .post(path)
          .set('X-Merchant-Request', '1')
          .send({ name: 'G4 menu', category_id: category.id, price: 25, stock_quantity: null })
          .expect(201);
        await manager
          .patch(path + '/' + created.body.id)
          .set('X-Merchant-Request', '1')
          .send({ price: 35, stock_quantity: 3, is_available: false })
          .expect(200);
        assert.equal((await kitchen.get(path + '/' + created.body.id).expect(200)).body.is_available, false);
        await cashier
          .patch(path + '/' + created.body.id)
          .set('X-Merchant-Request', '1')
          .send({ price: 1 })
          .expect(403);
        await manager
          .delete(path + '/' + created.body.id)
          .set('X-Merchant-Request', '1')
          .expect(200);
        await manager.get(path + '/' + created.body.id).expect(404);
      });
      await t.test('G5 group limits required and ownership chain', async () => {
        const item = await trx('menu_items').where({ merchant_id: 1 }).whereNull('deleted_at').first(),
          other = await trx('menu_items').where({ merchant_id: 2 }).first();
        const base = '/api/merchant/management/menu/' + item.id + '/groups';
        for (const invalid of [
          { name: 'bad', min_choices: 2, max_choices: 1 },
          { name: 'bad', is_required: true, min_choices: 0 },
        ])
          await manager.post(base).set('X-Merchant-Request', '1').send(invalid).expect(400);
        const group = (
          await manager
            .post(base)
            .set('X-Merchant-Request', '1')
            .send({ name: 'G5 group', is_required: true, min_choices: 1, max_choices: 2 })
            .expect(201)
        ).body;
        const choice = (
          await manager
            .post(base + '/' + group.id + '/choices')
            .set('X-Merchant-Request', '1')
            .send({ name: 'choice', extra_price: 5 })
            .expect(201)
        ).body;
        await manager
          .patch('/api/merchant/management/menu/' + other.id + '/groups/' + group.id)
          .set('X-Merchant-Request', '1')
          .send({ name: 'bad' })
          .expect(404);
        await manager
          .patch(base + '/' + group.id + '/choices/' + choice.id)
          .set('X-Merchant-Request', '1')
          .send({ extra_price: 10 })
          .expect(200);
        await manager
          .delete(base + '/' + group.id)
          .set('X-Merchant-Request', '1')
          .expect(200);
      });
      await t.test('G6 delivery fee free delivery and disabled area', async () => {
        const path = '/api/merchant/management/delivery-fees';
        const list = (await manager.get(path).expect(200)).body;
        assert.ok(list.items.length);
        const id = list.items[0].soi_id;
        await manager
          .put(path + '/' + id)
          .set('X-Merchant-Request', '1')
          .send({ enabled: true, fee: -1 })
          .expect(400);
        await manager
          .put(path + '/' + id)
          .set('X-Merchant-Request', '1')
          .send({ enabled: true, fee: 0 })
          .expect(200);
        assert.equal(
          Number((await trx('delivery_fees').where({ merchant_id: 1, soi_id: id }).first()).fee),
          0,
        );
        await manager
          .put(path + '/' + id)
          .set('X-Merchant-Request', '1')
          .send({ enabled: false })
          .expect(200);
        assert.equal(await trx('delivery_fees').where({ merchant_id: 1, soi_id: id }).first(), undefined);
        await manager
          .put(path + '/999999')
          .set('X-Merchant-Request', '1')
          .send({ enabled: true, fee: 0 })
          .expect(404);
      });
      await t.test('G7 staff passwords, inactive login, last manager, tenant isolation', async () => {
        const base = '/api/merchant/management/staff';
        const result = (
          await manager
            .post(base)
            .set('X-Merchant-Request', '1')
            .send({
              username: 'g7_test',
              password: 'Synthetic-local-123!',
              full_name: 'G7 test',
              role: 'CASHIER',
            })
            .expect(201)
        ).body;
        assert.equal(result.password_hash, undefined);
        const row = await trx('merchant_staffs').where({ id: result.id }).first();
        assert.equal(require('bcryptjs').getRounds(row.password_hash), 12);
        assert.ok(await require('bcryptjs').compare('Synthetic-local-123!', row.password_hash));
        const agent = request.agent(app);
        await agent.post('/api/dev/merchant/auth/login').send({ username: 'g7_test' }).expect(200);
        await manager
          .patch(base + '/' + result.id)
          .set('X-Merchant-Request', '1')
          .send({ is_active: false })
          .expect(200);
        await agent.get('/api/merchant/management/dashboard').expect(401);
        await agent.post('/api/dev/merchant/auth/login').send({ username: 'g7_test' }).expect(404);
        const own = await trx('merchant_staffs').where({ username: 'local_manager' }).first();
        await manager
          .patch(base + '/' + own.id)
          .set('X-Merchant-Request', '1')
          .send({ role: 'CASHIER' })
          .expect(409);
        const [other] = await trx('merchant_staffs')
          .insert({
            merchant_id: 2,
            username: 'g7_other',
            full_name: 'Other',
            role: 'MANAGER',
            password_hash: row.password_hash,
            is_active: true,
          })
          .returning('*');
        await manager
          .patch(base + '/' + other.id)
          .set('X-Merchant-Request', '1')
          .send({ full_name: 'bad' })
          .expect(404);
        await cashier.get(base).expect(403);
        const audit = await trx('audit_logs')
          .where({ action: 'STAFF_CREATED', actor_type: 'MERCHANT_STAFF' })
          .orderBy('id', 'desc')
          .first();
        assert.ok(audit);
        assert.ok(!JSON.stringify(audit).includes('Synthetic-local'));
      });
      await t.test('G8 rider management scope and derived status', async () => {
        const base = '/api/merchant/management';
        const created = (
          await manager
            .post(base + '/staff')
            .set('X-Merchant-Request', '1')
            .send({
              username: 'g8_rider',
              password: 'Synthetic-local-123!',
              full_name: 'G8 rider',
              role: 'RIDER',
            })
            .expect(201)
        ).body;
        const list = (await manager.get(base + '/riders').expect(200)).body.items;
        assert.ok(list.every((r) => r.merchant_id === 1));
        assert.equal(list.find((r) => r.id === created.id).availability, 'AVAILABLE');
        await manager.get(base + '/riders/' + created.id + '/history').expect(200);
        const other = await trx('merchant_staffs').where({ merchant_id: 2 }).first();
        await manager.get(base + '/riders/' + other.id + '/history').expect(404);
        await rider.get(base + '/riders').expect(403);
      });
      await t.test('G9 history bounded pagination filters and RBAC', async () => {
        const result = (await manager.get('/api/merchant/management/history?limit=2').expect(200)).body;
        assert.ok(result.items.length <= 2);
        assert.equal(result.pagination.limit, 2);
        await manager.get('/api/merchant/management/history?date=invalid').expect(400);
        await kitchen.get('/api/merchant/management/history').expect(403);
        await cashier.get('/api/merchant/management/history?search=nonexistent').expect(200);
      });
      await t.test('G10 reports SQL matches merchant-scoped totals', async () => {
        const result = (await manager.get('/api/merchant/management/reports?days=30').expect(200)).body;
        const expected = await trx('orders')
          .where({ merchant_id: 1, status: 'COMPLETED', payment_status: 'PAID' })
          .where(
            'created_at',
            '>=',
            trx.raw(
              "(date_trunc('day',now() AT TIME ZONE 'Asia/Bangkok') - interval '29 days') AT TIME ZONE 'Asia/Bangkok'",
            ),
          )
          .sum('total_amount as total')
          .first();
        assert.equal(Number(result.summary.revenue), Number(expected.total || 0));
        await kitchen.get('/api/merchant/management/reports').expect(403);
        await manager.get('/api/merchant/management/reports?days=999').expect(400);
        assert.deepEqual(
          (await cashier.get('/api/merchant/management/reports').expect(200)).body.options,
          [],
        );
      });
      await t.test('G11 own/global promotions and banner isolation read only', async () => {
        const [other] = await trx('banners')
          .insert({
            merchant_id: 2,
            scope: 'MERCHANT',
            title: 'Other private draft',
            image_object_key: 'banners/2026/10/test.png',
          })
          .returning('*');
        const result = (await manager.get('/api/merchant/management/banners').expect(200)).body;
        assert.ok(!result.items.some((b) => b.id === other.id));
        await manager.get('/api/merchant/management/banners/' + other.id + '/image').expect(404);
        const promotions = (await manager.get('/api/merchant/management/promotions').expect(200)).body;
        assert.ok(promotions.items.every((p) => p.merchant_id === null || p.merchant_id === 1));
        await manager
          .post('/api/merchant/management/promotions')
          .set('X-Merchant-Request', '1')
          .send({ name: 'forbidden' })
          .expect(404);
        await cashier.get('/api/merchant/management/banners').expect(403);
      });
      await t.test(
        'management changes affect new checkout but preserve historical snapshots and reports',
        async () => {
          const staff = await trx('merchant_staffs').where({ username: 'local_manager' }).first();
          const category = await trx('menu_categories')
            .where({ merchant_id: 1, is_active: true })
            .whereNull('deleted_at')
            .first();
          const item = await management.saveMenu(staff, null, {
            name: 'Snapshot original',
            category_id: category.id,
            price: 40,
            stock_quantity: 2,
          });
          const group = await management.optionGroup(staff, item.id, null, { name: 'Extras' });
          const choice = await management.optionChoice(staff, item.id, group.id, null, {
            name: 'Original extra',
            extra_price: 5,
          });
          const service = require('../src/order-service.cjs').createOrderService(trx);
          const payload = {
            merchantId: 1,
            deliveryType: 'PICKUP',
            items: [{ menuItemId: item.id, quantity: 1, optionChoiceIds: [choice.id] }],
          };
          const order = await service.createOrder(1, payload);
          await management.saveMenu(staff, item.id, { name: 'Snapshot changed', price: 80 });
          await management.optionChoice(staff, item.id, group.id, choice.id, {
            name: 'Changed extra',
            extra_price: 10,
          });
          assert.equal((await service.quoteOrder(1, payload)).total_amount, 90);
          const original = await service.getOrder(1, order.id);
          assert.equal(original.items[0].item_name, 'Snapshot original');
          assert.equal(original.items[0].unit_price, 40);
          assert.equal(original.items[0].choices[0].choice_name, 'Original extra');
          assert.equal(original.total_amount, 45);
          await assert.rejects(
            management.saveStore(staff, { promptpay_id: '0811111111', promptpay_identifier_type: 'PHONE' }),
            (e) => e.code === 'pending_payment_prevents_promptpay_change',
          );
          await management.optionChoice(staff, item.id, group.id, choice.id, {}, true);
          assert.equal((await service.getOrder(1, order.id)).items[0].choices[0].extra_price, 5);
          await trx('orders')
            .where({ id: order.id })
            .update({ status: 'COMPLETED', payment_status: 'PAID', completed_at: trx.fn.now() });
          const before = await management.reports(staff, { days: 1 });
          const [other] = await trx('orders')
            .insert({
              merchant_id: 2,
              customer_id: 1,
              order_code: 'G_OTHER_REPORT',
              merchant_order_number: 999999,
              delivery_type: 'PICKUP',
              payment_method: 'PROMPTPAY',
              status: 'COMPLETED',
              payment_status: 'PAID',
              subtotal_amount: 9000,
              delivery_fee: 0,
              total_amount: 9000,
            })
            .returning('id');
          const after = await management.reports(staff, { days: 1 });
          assert.equal(after.summary.revenue, before.summary.revenue);
          assert.ok(after.best.some((r) => r.item_name === 'Snapshot original'));
          assert.ok(!(await management.history(staff, {})).items.some((o) => o.id === other.id));
          await management.saveMenu(staff, item.id, { stock_quantity: 2 });
          await assert.rejects(
            service.quoteOrder(1, { ...payload, items: [{ menuItemId: item.id, quantity: 3 }] }),
            (e) => e.status === 409,
          );
          await trx('merchants').where({ id: 1 }).update({ is_active: false });
          await assert.rejects(
            service.quoteOrder(1, { ...payload, items: [{ menuItemId: item.id, quantity: 1 }] }),
            (e) => e.code === 'merchant_suspended',
          );
          await trx('merchants').where({ id: 1 }).update({ is_active: true });
        },
      );
    } finally {
      await trx.rollback();
      await db.destroy();
    }
  },
);

test(
  'concurrent last-manager demotion is serialized per merchant',
  { skip: process.env.DB_HOST !== '127.0.0.1' || process.env.DB_NAME !== 'select_topic_2_local' },
  async () => {
    const db = createDatabase(process.env, { required: true });
    let merchantId;
    let ids = [];
    try {
      const [merchant] = await db('merchants')
        .insert({
          store_name: 'G concurrency fixture',
          phone: '0800000000',
          location_text: 'local',
          promptpay_identifier_type: 'PHONE',
          promptpay_id: '0800000000',
          prefix: 'G' + Date.now().toString(36),
        })
        .returning('*');
      merchantId = merchant.id;
      const staffs = await db('merchant_staffs')
        .insert(
          [1, 2].map((n) => ({
            merchant_id: merchantId,
            username: `g_concurrent_${merchantId}_${n}`,
            full_name: `Manager ${n}`,
            password_hash: 'fixture-not-for-login',
            role: 'MANAGER',
          })),
        )
        .returning('*');
      ids = staffs.map((s) => s.id);
      const service = createMerchantManagement({ db, storage: {}, staffAuth: { revokeStaff() {} } });
      const results = await Promise.allSettled(
        staffs.map((s) => service.saveStaff(s, s.id, { role: 'CASHIER' })),
      );
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(
        (await db('merchant_staffs').where({ merchant_id: merchantId, role: 'MANAGER', is_active: true }))
          .length,
        1,
      );
    } finally {
      if (merchantId) {
        await db('audit_logs').where({ actor_type: 'MERCHANT_STAFF' }).whereIn('actor_id', ids).del();
        await db('merchant_staffs').where({ merchant_id: merchantId }).del();
        await db('merchants').where({ id: merchantId }).del();
      }
      await db.destroy();
    }
  },
);

test(
  'rider deactivation racing assignment cannot leave an inactive assigned rider',
  { skip: process.env.DB_HOST !== '127.0.0.1' || process.env.DB_NAME !== 'select_topic_2_local' },
  async () => {
    const db = createDatabase(process.env, { required: true });
    let merchantId, orderId;
    let ids = [];
    try {
      const [m] = await db('merchants')
        .insert({
          store_name: 'G rider race fixture',
          phone: '0800000000',
          location_text: 'local',
          promptpay_identifier_type: 'PHONE',
          promptpay_id: '0800000000',
          prefix: 'R' + Date.now().toString(36),
        })
        .returning('*');
      merchantId = m.id;
      const people = await db('merchant_staffs')
        .insert(
          ['MANAGER', 'RIDER'].map((role) => ({
            merchant_id: m.id,
            username: `g_race_${m.id}_${role}`,
            full_name: role,
            password_hash: 'fixture-not-for-login',
            role,
          })),
        )
        .returning('*');
      ids = people.map((s) => s.id);
      const [manager, rider] = people;
      const [order] = await db('orders')
        .insert({
          merchant_id: m.id,
          customer_id: 1,
          order_code: `G_RACE_${m.id}`,
          merchant_order_number: 1,
          delivery_type: 'DELIVERY',
          payment_method: 'PROMPTPAY',
          status: 'READY',
          payment_status: 'PAID',
          subtotal_amount: 10,
          delivery_fee: 0,
          total_amount: 10,
          customer_address_id: 1,
          delivery_address_label: 'test',
          delivery_soi_name: 'test',
          delivery_dormitory_name: 'test',
          delivery_location_text: 'test',
          delivery_room_number: 'test',
          delivery_contact_phone: '0800000000',
        })
        .returning('id');
      orderId = order.id;
      const service = createMerchantManagement({ db, storage: {}, staffAuth: { revokeStaff() {} } });
      await Promise.allSettled([
        service.saveStaff(manager, rider.id, { is_active: false }),
        createMerchantOrderService(db).assignRider(manager, orderId, rider.id),
      ]);
      const current = await db('orders').where({ id: orderId }).first(),
        r = await db('merchant_staffs').where({ id: rider.id }).first();
      assert.ok(!current.assigned_rider_id || r.is_active);
    } finally {
      if (orderId) await db('orders').where({ id: orderId }).del();
      if (merchantId) {
        await db('audit_logs').where({ actor_type: 'MERCHANT_STAFF' }).whereIn('actor_id', ids).del();
        await db('merchant_staffs').where({ merchant_id: merchantId }).del();
        await db('merchants').where({ id: merchantId }).del();
      }
      await db.destroy();
    }
  },
);
