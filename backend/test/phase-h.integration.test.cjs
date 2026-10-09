const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const request = require("supertest");
require("../src/env.cjs");
const { createDatabase, createDatabaseProbe } = require("../src/database.cjs");
const { createApp } = require("../src/app.cjs");
const { createCustomerAuth } = require("../src/auth.cjs");
const { createCustomerRepository } = require("../src/customer-repository.cjs");
const { createStoreRepository } = require("../src/store-repository.cjs");
const { createOrderService } = require("../src/order-service.cjs");
const { createCustomerEngagement } = require("../src/customer-engagement.cjs");
const { createPersistentIdempotencyStore } = require("../src/idempotency.cjs");
const { createNotificationOutbox } = require("../src/notification-outbox.cjs");
const { createAdminAudit } = require("../src/admin-audit.cjs");
const { createAdminService } = require("../src/admin-service.cjs");

test(
  "Phase H customer engagement and commerce completion",
  {
    skip:
      !(
        process.env.DB_HOST === "127.0.0.1" &&
        process.env.DB_NAME === "select_topic_2_local"
      ) && "local DB required",
  },
  async (t) => {
    const db = createDatabase(process.env, { required: true });
    const tag = crypto.randomUUID().slice(0, 8);
    const engagement = createCustomerEngagement(db);
    const orders = createOrderService(db);
    const idempotencyKeys = [];
    const couponIds = [];
    let merchantId;
    let secondCustomer;
    const appFor = (lineUserId) =>
      createApp({
        checkDatabase: createDatabaseProbe(db),
        auth: createCustomerAuth({
          db,
          config: {
            mode: "mock",
            devLoginEnabled: true,
            devLineUserId: lineUserId,
            secureCookie: false,
          },
        }),
        customers: createCustomerRepository(db),
        stores: createStoreRepository(db),
        orders,
        engagement,
        idempotency: createPersistentIdempotencyStore({ db }),
      });
    const coupon = async (overrides = {}) => {
      const [row] = await db("coupons")
        .insert({
          code: `H${tag}${couponIds.length}`.toUpperCase(),
          name: `Phase H ${tag}`,
          funding_source: 'MERCHANT', promotion_type: "PERCENTAGE",
          value: 10,
          minimum_order_amount: 0,
          starts_at: new Date(Date.now() - 60000),
          ends_at: new Date(Date.now() + 3600000),
          per_customer_limit: null,
          ...overrides,
        })
        .returning("*");
      couponIds.push(row.id);
      return row;
    };
    try {
      const firstCustomer = await db("customers")
        .where({ line_user_id: "U_LOCAL_CUSTOMER_001" })
        .first();
      [secondCustomer] = await db("customers")
        .insert({
          line_user_id: `U_H_${tag}`,
          display_name: "Phase H second customer",
          is_active: true,
        })
        .returning("*");
      const dorm = await db("dormitories as d")
        .join("sois as s", "s.id", "d.soi_id")
        .where({ "d.is_active": true })
        .first("d.id", "s.id as soi_id");
      const firstAddress = await db("customer_addresses")
        .where({ customer_id: firstCustomer.id, is_default: true })
        .first();
      const [secondAddress] = await db("customer_addresses")
        .insert({
          customer_id: secondCustomer.id,
          dormitory_id: dorm.id,
          label: "Test",
          room_number: "H-2",
          contact_phone: "0800000000",
          is_default: true,
        })
        .returning("*");
      [merchantId] = (
        await db("merchants")
          .insert({
            store_name: `Phase H ${tag}`,
            prefix: `H${tag}`,
            phone: "0800000000",
            location_text: "Local",
            promptpay_identifier_type: "PHONE",
            promptpay_id: "0800000000",
            is_open: true,
            is_active: true,
          })
          .returning("id")
      ).map((row) => row.id);
      const [category] = await db("menu_categories")
        .insert({ merchant_id: merchantId, name: "Phase H", is_active: true })
        .returning("*");
      const [item] = await db("menu_items")
        .insert({
          merchant_id: merchantId,
          category_id: category.id,
          name: "Phase H meal",
          price: 100,
          is_available: true,
          stock_quantity: 20,
        })
        .returning("*");
      const [group] = await db("menu_option_groups")
        .insert({
          menu_item_id: item.id,
          name: "Size",
          is_required: true,
          min_choices: 1,
          max_choices: 1,
        })
        .returning("*");
      const [choice] = await db("menu_option_choices")
        .insert({
          option_group_id: group.id,
          name: "Regular",
          extra_price: 10,
          is_available: true,
        })
        .returning("*");
      await db("delivery_fees").insert({
        merchant_id: merchantId,
        soi_id: dorm.soi_id,
        fee: 15,
      });
      const payload = (addressId, extra = {}) => ({
        merchantId,
        deliveryType: "DELIVERY",
        addressId,
        items: [
          { menuItemId: item.id, quantity: 1, optionChoiceIds: [choice.id] },
        ],
        ...extra,
      });
      const first = request.agent(appFor(firstCustomer.line_user_id));
      const second = request.agent(appFor(secondCustomer.line_user_id));
      await first.post("/api/dev/auth/login").expect(200);
      await second.post("/api/dev/auth/login").expect(200);
      const create = (agent, body, key = `phase-h-${crypto.randomUUID()}`) => {
        idempotencyKeys.push(key);
        return agent.post("/api/orders").set("Idempotency-Key", key).send(body);
      };

      const completed = (
        await create(first, payload(firstAddress.id)).expect(201)
      ).body.order;
      await db("orders")
        .where({ id: completed.id })
        .update({
          status: "COMPLETED",
          payment_status: "PAID",
          completed_at: db.fn.now(),
        });
      const pending = (
        await create(first, payload(firstAddress.id)).expect(201)
      ).body.order;

      await t.test(
        "reviews enforce completed ownership, one per order, validation and DB aggregate",
        async () => {
          assert.equal(
            (await first.get(`/api/orders/${completed.id}/review`).expect(200))
              .body.eligible,
            true,
          );
          await first
            .post(`/api/orders/${pending.id}/review`)
            .send({ rating: 5 })
            .expect(409);
          await second
            .post(`/api/orders/${completed.id}/review`)
            .send({ rating: 5 })
            .expect(404);
          await first
            .post(`/api/orders/${completed.id}/review`)
            .send({ rating: 6 })
            .expect(400);
          await first
            .post(`/api/orders/${completed.id}/review`)
            .send({ rating: 5, comment: "  อร่อยมาก  " })
            .expect(201);
          await first
            .post(`/api/orders/${completed.id}/review`)
            .send({ rating: 4 })
            .expect(409);
          const result = (
            await first.get(`/api/merchants/${merchantId}/reviews`).expect(200)
          ).body;
          assert.equal(result.average_rating, 5);
          assert.equal(result.review_count, 1);
          assert.equal(result.reviews[0].comment, "อร่อยมาก");
        },
      );

      await t.test(
        "favorites are idempotent and customer isolated",
        async () => {
          await first.post(`/api/customer/favorites/${merchantId}`).expect(201);
          await first.post(`/api/customer/favorites/${merchantId}`).expect(201);
          assert.equal(
            (
              await first.get("/api/customer/favorites").expect(200)
            ).body.merchants.filter((row) => row.id === merchantId).length,
            1,
          );
          assert.equal(
            (
              await second.get("/api/customer/favorites").expect(200)
            ).body.merchants.some((row) => row.id === merchantId),
            false,
          );
          await first
            .delete(`/api/customer/favorites/${merchantId}`)
            .expect(200);
          await first
            .delete(`/api/customer/favorites/${merchantId}`)
            .expect(200);
        },
      );

      await t.test(
        "reorder resolves current price and reports unavailable or removed options",
        async () => {
          await db("menu_items").where({ id: item.id }).update({ price: 120 });
          let preview = (
            await first
              .post(`/api/orders/${completed.id}/reorder-preview`)
              .expect(200)
          ).body;
          assert.equal(preview.available_items[0].unitPriceEstimate, 120);
          assert.equal(preview.changed_prices.length, 1);
          await db("menu_option_choices")
            .where({ id: choice.id })
            .update({ is_available: false });
          preview = (
            await first
              .post(`/api/orders/${completed.id}/reorder-preview`)
              .expect(200)
          ).body;
          assert.equal(preview.unavailable_items[0].reason, "OPTION_MISSING");
          await db("menu_option_choices")
            .where({ id: choice.id })
            .update({ is_available: true });
          await db("merchants")
            .where({ id: merchantId })
            .update({ is_active: false });
          await first
            .post(`/api/orders/${completed.id}/reorder-preview`)
            .expect(409);
          await db("merchants")
            .where({ id: merchantId })
            .update({ is_active: true });
        },
      );

      await t.test(
        "coupon percentage, fixed, free delivery, scope, schedule, minimum and zero-total rules",
        async () => {
          for (const [type, value, expected] of [
            ["PERCENTAGE", 10, 13],
            ["FIXED_AMOUNT", 20, 20],
            ["FREE_DELIVERY", 0, 15],
          ]) {
            const current = await coupon({ funding_source: 'MERCHANT', promotion_type: type, value });
            const quote = (
              await first
                .post("/api/orders/quote")
                .send(
                  payload(firstAddress.id, {
                    couponCode: current.code.toLowerCase(),
                  }),
                )
                .expect(200)
            ).body.quote;
            assert.equal(quote.discount_amount, expected);
            assert.equal(quote.coupon_snapshot.code, current.code);
            assert.equal(quote.coupon_snapshot.discount_satang, expected * 100);
          }
          for (const [override, status, code] of [
            [{ is_active: false }, 422, "coupon_unavailable"],
            [{ minimum_order_amount: 200 }, 422, "coupon_minimum_not_met"],
            [
              { starts_at: new Date(Date.now() + 60000) },
              422,
              "coupon_unavailable",
            ],
            [
              {
                starts_at: new Date(Date.now() - 120000),
                ends_at: new Date(Date.now() - 60000),
              },
              422,
              "coupon_unavailable",
            ],
            [{ merchant_id: 1 }, 422, "coupon_wrong_merchant"],
          ]) {
            const current = await coupon(override);
            const result = await first
              .post("/api/orders/quote")
              .send(payload(firstAddress.id, { couponCode: current.code }))
              .expect(status);
            assert.equal(result.body.error, code);
          }
          const zero = await coupon({
            funding_source: 'MERCHANT', promotion_type: "FIXED_AMOUNT",
            value: 999,
          });
          const pickup = {
            merchantId,
            deliveryType: "PICKUP",
            items: [
              {
                menuItemId: item.id,
                quantity: 1,
                optionChoiceIds: [choice.id],
              },
            ],
            couponCode: zero.code,
          };
          assert.equal(
            (await first.post("/api/orders/quote").send(pickup).expect(422))
              .body.error,
            "coupon_zero_total_unsupported",
          );
          const promo = await db("promotions")
            .where({ is_active: true })
            .whereNull("deleted_at")
            .first();
          if (promo)
            await first
              .post("/api/orders/quote")
              .send(
                payload(firstAddress.id, {
                  couponCode: zero.code,
                  promotionId: promo.id,
                }),
              )
              .expect(400);
        },
      );

      await t.test(
        "coupon quota is row-locked, per-customer limited and idempotent replay consumes once",
        async () => {
          const limited = await coupon({ usage_limit: 1 });
          const results = await Promise.all([
            create(
              first,
              payload(firstAddress.id, { couponCode: limited.code }),
            ),
            create(
              second,
              payload(secondAddress.id, { couponCode: limited.code }),
            ),
          ]);
          assert.deepEqual(
            results.map((result) => result.status).sort(),
            [201, 409],
          );
          assert.equal(
            (await db("coupons").where({ id: limited.id }).first()).usage_count,
            1,
          );
          const perCustomer = await coupon({ per_customer_limit: 1 });
          const key = `phase-h-${crypto.randomUUID()}`;
          const firstOrder = await create(
            first,
            payload(firstAddress.id, { couponCode: perCustomer.code }),
            key,
          ).expect(201);
          const replay = await create(
            first,
            payload(firstAddress.id, { couponCode: perCustomer.code }),
            key,
          ).expect(201);
          assert.equal(replay.body.order.id, firstOrder.body.order.id);
          assert.equal(
            (await db("coupons").where({ id: perCustomer.id }).first())
              .usage_count,
            1,
          );
          assert.equal(
            (
              await create(
                first,
                payload(firstAddress.id, { couponCode: perCustomer.code }),
              ).expect(409)
            ).body.error,
            "coupon_customer_limit",
          );
        },
      );

      await t.test(
        "customer notification projection is durable, deduplicated, readable and isolated",
        async () => {
          const outbox = createNotificationOutbox({
            db,
            messaging: { push: async () => ({ sent: false, disabled: true }) },
            publicAppUrl: "http://127.0.0.1:3000",
          });
          await db.transaction((trx) =>
            outbox.enqueueOrderEvent(trx, "COMPLETED", completed.id),
          );
          await db.transaction((trx) =>
            outbox.enqueueOrderEvent(trx, "COMPLETED", completed.id),
          );
          const list = await engagement.listNotifications(firstCustomer.id);
          const notification = list.items.find(
            (row) => row.event_key === `COMPLETED:${completed.id}`,
          );
          assert.ok(notification);
          assert.equal(
            list.items.filter((row) => row.event_key === notification.event_key)
              .length,
            1,
          );
          assert.equal(
            (await engagement.listNotifications(secondCustomer.id)).items.some(
              (row) => row.id === notification.id,
            ),
            false,
          );
          await assert.rejects(
            engagement.markNotificationRead(secondCustomer.id, notification.id),
            { code: "notification_not_found" },
          );
          await engagement.markNotificationRead(
            firstCustomer.id,
            notification.id,
          );
          assert.equal(
            (await engagement.listNotifications(firstCustomer.id)).items.find(
              (row) => row.id === notification.id,
            ).is_read,
            true,
          );
        },
      );

      await t.test(
        "admin review moderation and coupon writes append required audit events",
        async () => {
          const audit = createAdminAudit(db);
          const admins = createAdminService({ db, audit });
          const actor = await db("platform_admins")
            .where({ username: "local_super_admin" })
            .first();
          const review = await db("reviews")
            .where({ order_id: completed.id })
            .first();
          await admins.setReviewStatus(actor, review.id, "HIDDEN", {});
          await admins.setReviewStatus(actor, review.id, "PUBLISHED", {});
          const current = await admins.saveCoupon(
            actor,
            null,
            {
              code: `ADMIN${tag}`,
              name: "Admin coupon",
              description: null,
              merchant_id: merchantId,
              funding_source: 'MERCHANT', promotion_type: "PERCENTAGE",
              value: 5,
              minimum_order_amount: 0,
              maximum_discount_amount: null,
              starts_at: new Date(Date.now() - 60000),
              ends_at: new Date(Date.now() + 3600000),
              usage_limit: 10,
              per_customer_limit: 1,
              is_active: true,
            },
            {},
          );
          couponIds.push(current.id);
          await admins.saveCoupon(actor, current.id, { is_active: false }, {});
          const actions = (
            await db("audit_logs")
              .whereIn("action", [
                "REVIEW_HIDDEN",
                "REVIEW_PUBLISHED",
                "COUPON_CREATED",
                "COUPON_DISABLED",
              ])
              .where("created_at", ">=", new Date(Date.now() - 60000))
          ).map((row) => row.action);
          for (const action of [
            "REVIEW_HIDDEN",
            "REVIEW_PUBLISHED",
            "COUPON_CREATED",
            "COUPON_DISABLED",
          ])
            assert.ok(actions.includes(action));
        },
      );
    } finally {
      if (merchantId) {
        const orderIds = (
          await db("orders").where({ merchant_id: merchantId }).select("id")
        ).map((row) => row.id);
        if (orderIds.length) {
          await db("reviews").whereIn("order_id", orderIds).delete();
          await db("customer_notifications")
            .whereIn("order_id", orderIds)
            .delete();
          await db("notification_outbox")
            .whereIn("order_id", orderIds)
            .delete();
          await db("coupon_redemptions").whereIn("order_id", orderIds).delete();
          await db("promotion_redemptions")
            .whereIn("order_id", orderIds)
            .delete();
          const orderItemIds = (
            await db("order_items").whereIn("order_id", orderIds).select("id")
          ).map((row) => row.id);
          if (orderItemIds.length)
            await db("order_item_choices")
              .whereIn("order_item_id", orderItemIds)
              .delete();
          await db("order_items").whereIn("order_id", orderIds).delete();
          await db("orders").whereIn("id", orderIds).delete();
        }
        await db("customer_favorite_merchants")
          .where({ merchant_id: merchantId })
          .delete();
        await db("audit_logs")
          .whereIn("entity_type", ["REVIEW", "COUPON"])
          .where("created_at", ">=", new Date(Date.now() - 10 * 60 * 1000))
          .delete();
        await db("coupons").whereIn("id", couponIds).delete();
        await db("delivery_fees").where({ merchant_id: merchantId }).delete();
        const itemIds = (
          await db("menu_items").where({ merchant_id: merchantId }).select("id")
        ).map((row) => row.id);
        const groupIds = itemIds.length
          ? (
              await db("menu_option_groups")
                .whereIn("menu_item_id", itemIds)
                .select("id")
            ).map((row) => row.id)
          : [];
        if (groupIds.length)
          await db("menu_option_choices")
            .whereIn("option_group_id", groupIds)
            .delete();
        if (itemIds.length)
          await db("menu_option_groups")
            .whereIn("menu_item_id", itemIds)
            .delete();
        await db("menu_items").where({ merchant_id: merchantId }).delete();
        await db("menu_categories").where({ merchant_id: merchantId }).delete();
        await db("merchants").where({ id: merchantId }).delete();
      }
      await db("idempotency_keys")
        .whereIn("idempotency_key", idempotencyKeys)
        .delete();
      if (secondCustomer) {
        await db("customer_addresses")
          .where({ customer_id: secondCustomer.id })
          .delete();
        await db("customers").where({ id: secondCustomer.id }).delete();
      }
      await db.destroy();
    }
  },
);
