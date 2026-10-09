const bcrypt = require('bcryptjs');
const fs = require('node:fs/promises');
const path = require('node:path');

async function upsertOne(trx, table, where, values) {
  const existing = await trx(table).where(where).first('id');
  if (existing) {
    await trx(table).where({ id: existing.id }).update(values);
    return existing.id;
  }
  const [created] = await trx(table).insert({ ...where, ...values }).returning('id');
  return created.id;
}

async function seedMenuItem(trx, merchantId, categoryId, item) {
  const itemId = await upsertOne(trx, 'menu_items', { merchant_id: merchantId, name: item.name }, {
    category_id: categoryId,
    description: item.description,
    image_url: item.image,
    price: item.price,
    is_available: item.available ?? true,
    stock_quantity: item.stock ?? null,
    sort_order: item.order,
    updated_at: trx.fn.now(),
    deleted_at: null,
  });
  for (const [groupOrder, group] of (item.groups || []).entries()) {
    const groupId = await upsertOne(trx, 'menu_option_groups', { menu_item_id: itemId, name: group.name }, {
      is_required: group.required,
      min_choices: group.min,
      max_choices: group.max,
      sort_order: groupOrder,
    });
    for (const [choiceOrder, choice] of group.choices.entries()) {
      await upsertOne(trx, 'menu_option_choices', { option_group_id: groupId, name: choice.name }, {
        extra_price: choice.price,
        is_available: choice.available ?? true,
        sort_order: choiceOrder,
      });
    }
  }
}

async function seedMerchant(trx, merchant, soiIds) {
  const merchantId = await upsertOne(trx, 'merchants', { prefix: merchant.prefix }, {
    store_name: merchant.name,
    phone: merchant.phone,
    location_text: merchant.location,
    promptpay_identifier_type: 'PHONE',
    promptpay_id: merchant.phone,
    is_open: merchant.open,
    is_active: true,
    suspended_at: null,
    suspension_reason: null,
    suspended_by_admin_id: null,
    updated_at: trx.fn.now(),
    deleted_at: null,
  });
  await trx('merchant_images').where({ merchant_id: merchantId }).delete();
  await trx('merchant_images').insert(merchant.images.map((image, index) => ({
    merchant_id: merchantId,
    image_url: image,
    alt_text: merchant.name,
    sort_order: index,
    is_primary: index === 0,
  })));
  for (const [soiName, fee] of Object.entries(merchant.fees)) {
    await upsertOne(trx, 'delivery_fees', { merchant_id: merchantId, soi_id: soiIds[soiName] }, { fee });
  }
  for (const [categoryOrder, category] of merchant.categories.entries()) {
    const categoryId = await upsertOne(trx, 'menu_categories', { merchant_id: merchantId, name: category.name }, {
      sort_order: categoryOrder,
      is_active: true,
      updated_at: trx.fn.now(),
      deleted_at: null,
    });
    for (const [itemOrder, item] of category.items.entries()) {
      await seedMenuItem(trx, merchantId, categoryId, { ...item, order: itemOrder });
    }
  }
  return merchantId;
}

exports.seed = async (knex) => {
  const connection = knex.client.config.connection;
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  if (!localHosts.has(connection.host) || connection.database !== 'select_topic_2_local') {
    throw new Error('Local seed is restricted to select_topic_2_local on loopback.');
  }

  await knex.transaction(async (trx) => {
    const soiIds = {};
    for (const name of ['Local Soi 1', 'Campus Soi', 'Garden Soi']) {
      soiIds[name] = await upsertOne(trx, 'sois', { name }, { is_active: true, updated_at: trx.fn.now() });
    }
    const dormitoryIds = {};
    for (const dormitory of [
      ['Local Dorm A', 'Local Soi 1', 'Near the main gate'],
      ['Campus Place', 'Campus Soi', 'Opposite the library'],
      ['Garden Residence', 'Garden Soi', 'Behind the community park'],
      ['North Hall', 'Campus Soi', 'North side of campus'],
    ]) {
      dormitoryIds[dormitory[0]] = await upsertOne(trx, 'dormitories', {
        soi_id: soiIds[dormitory[1]], name: dormitory[0],
      }, { location_text: dormitory[2], is_active: true, updated_at: trx.fn.now() });
    }

    const customerId = await upsertOne(trx, 'customers', { line_user_id: 'U_LOCAL_CUSTOMER_001' }, {
      display_name: 'Mali Demo',
      profile_image_url: null,
      phone: '0812345678',
      is_active: true,
      updated_at: trx.fn.now(),
    });
    await upsertOne(trx, 'customer_addresses', { customer_id: customerId, label: 'Home' }, {
      dormitory_id: dormitoryIds['Local Dorm A'], room_number: 'A-101', contact_phone: '0812345678',
      address_detail: 'Leave with the lobby if unavailable', is_default: true, updated_at: trx.fn.now(),
    });
    await upsertOne(trx, 'customer_addresses', { customer_id: customerId, label: 'Campus' }, {
      dormitory_id: dormitoryIds['Campus Place'], room_number: 'C-204', contact_phone: '0812345678',
      address_detail: 'Call on arrival', is_default: false, updated_at: trx.fn.now(),
    });

    const commonSpice = { name: 'Spiciness', required: true, min: 1, max: 1, choices: [
      { name: 'Mild', price: 0 }, { name: 'Medium', price: 0 }, { name: 'Hot', price: 0 },
    ] };
    const merchants = [
      {
        prefix: 'LOC', name: 'Local Kitchen', phone: '0811111111', location: 'Main gate food court', open: true,
        images: ['/demo/local-kitchen.svg', '/demo/local-kitchen-2.svg'],
        fees: { 'Local Soi 1': 15, 'Campus Soi': 20, 'Garden Soi': 25 },
        categories: [
          { name: 'Rice Dishes', items: [
            { name: 'Local Basil Rice', description: 'Fragrant basil stir-fry over jasmine rice', image: '/demo/basil-rice.svg', price: 60, stock: 20, groups: [commonSpice, { name: 'Extras', required: false, min: 0, max: 2, choices: [{ name: 'Fried egg', price: 10 }, { name: 'Extra rice', price: 10 }] }] },
            { name: 'Garlic Chicken Rice', description: 'Crispy garlic chicken with cucumber', image: '/demo/garlic-chicken.svg', price: 65, stock: 12, groups: [{ name: 'Rice', required: true, min: 1, max: 1, choices: [{ name: 'Jasmine rice', price: 0 }, { name: 'Brown rice', price: 10 }] }] },
            { name: 'Crispy Pork Basil Rice', description: 'Crispy pork, holy basil and jasmine rice', image: '/demo/basil-rice.svg', price: 75, stock: 14, groups: [commonSpice] },
            { name: 'Pepper Chicken Rice', description: 'Black pepper chicken with seasonal vegetables', image: '/demo/garlic-chicken.svg', price: 70, stock: 11 },
          ] },
          { name: 'Drinks', items: [
            { name: 'Thai Milk Tea', description: 'Freshly brewed and lightly sweet', image: '/demo/thai-tea.svg', price: 40, stock: 30, groups: [{ name: 'Sweetness', required: true, min: 1, max: 1, choices: [{ name: 'No sugar', price: 0 }, { name: 'Half sweet', price: 0 }, { name: 'Regular', price: 0 }] }] },
            { name: 'Lime Tea', description: 'Fresh lime with fragrant black tea', image: '/demo/thai-tea.svg', price: 35, stock: 24 },
          ] },
        ],
      },
      {
        prefix: 'NDL', name: 'Soi Noodle House', phone: '0822222222', location: 'Corner of Campus Soi', open: true,
        images: ['/demo/noodle-house.svg', '/demo/noodle-house-2.svg'],
        fees: { 'Local Soi 1': 20, 'Campus Soi': 10, 'Garden Soi': 25 },
        categories: [
          { name: 'Noodles', items: [
            { name: 'Tom Yum Noodles', description: 'Tangy broth, roasted peanuts and lime', image: '/demo/tom-yum-noodles.svg', price: 70, stock: 16, groups: [commonSpice, { name: 'Noodle type', required: true, min: 1, max: 1, choices: [{ name: 'Rice noodles', price: 0 }, { name: 'Egg noodles', price: 5 }] }] },
            { name: 'Dry Pork Noodles', description: 'House sauce with herbs and crispy garlic', image: '/demo/dry-noodles.svg', price: 65, stock: 10, groups: [{ name: 'Size', required: true, min: 1, max: 1, choices: [{ name: 'Regular', price: 0 }, { name: 'Large', price: 20 }] }] },
            { name: 'Clear Soup Noodles', description: 'Light pork broth with vegetables and herbs', image: '/demo/tom-yum-noodles.svg', price: 60, stock: 18 },
            { name: 'Spicy Dry Noodles', description: 'Dry noodles tossed with chilli, lime and peanuts', image: '/demo/dry-noodles.svg', price: 70, stock: 9, groups: [commonSpice] },
          ] },
          { name: 'Sides', items: [
            { name: 'Crispy Wontons', description: 'Six golden wontons with sweet chilli dip', image: '/demo/wontons.svg', price: 45, stock: 8 },
            { name: 'Pork Dumplings', description: 'Steamed pork dumplings with soy dip', image: '/demo/wontons.svg', price: 55, stock: 12 },
          ] },
        ],
      },
      {
        prefix: 'GRN', name: 'Green Bowl', phone: '0833333333', location: 'Garden community market', open: false,
        images: ['/demo/green-bowl.svg', '/demo/green-bowl-2.svg'],
        fees: { 'Local Soi 1': 25, 'Campus Soi': 25, 'Garden Soi': 10 },
        categories: [
          { name: 'Healthy Bowls', items: [
            { name: 'Sesame Chicken Bowl', description: 'Greens, grains and sesame chicken', image: '/demo/sesame-bowl.svg', price: 95, stock: 6, groups: [{ name: 'Dressing', required: true, min: 1, max: 1, choices: [{ name: 'Sesame', price: 0 }, { name: 'Lime soy', price: 0 }] }] },
            { name: 'Tofu Garden Bowl', description: 'Seasonal vegetables, tofu and brown rice', image: '/demo/tofu-bowl.svg', price: 85, stock: 0, available: false },
            { name: 'Salmon Grain Bowl', description: 'Grilled salmon, grains and fresh vegetables', image: '/demo/sesame-bowl.svg', price: 125, stock: 5 },
            { name: 'Avocado Tofu Bowl', description: 'Avocado, tofu, vegetables and lime soy dressing', image: '/demo/tofu-bowl.svg', price: 105, stock: 7 },
          ] },
          { name: 'Smoothies', items: [
            { name: 'Mango Oat Smoothie', description: 'Mango, oat milk and banana', image: '/demo/mango-smoothie.svg', price: 65, stock: 15 },
            { name: 'Berry Banana Smoothie', description: 'Mixed berries, banana and oat milk', image: '/demo/mango-smoothie.svg', price: 70, stock: 10 },
          ] },
        ],
      },
    ];

    let firstMerchantId;
    for (const merchant of merchants) {
      const merchantId = await seedMerchant(trx, merchant, soiIds);
      if (!firstMerchantId) firstMerchantId = merchantId;
    }

    // Retire names from the original one-item bootstrap seed so reruns stay deterministic.
    const basilItem = await trx('menu_items')
      .where({ merchant_id: firstMerchantId, name: 'Local Basil Rice' }).first('id');
    if (basilItem) {
      const legacyGroup = await trx('menu_option_groups')
        .where({ menu_item_id: basilItem.id, name: 'Add egg' }).first('id');
      if (legacyGroup) {
        await trx('menu_option_choices').where({ option_group_id: legacyGroup.id }).delete();
        await trx('menu_option_groups').where({ id: legacyGroup.id }).delete();
      }
    }
    await trx('menu_categories').where({ merchant_id: firstMerchantId, name: 'Main Dishes' })
      .whereNotExists(trx('menu_items').select(1).whereRaw('menu_items.category_id = menu_categories.id'))
      .delete();

    const passwordHash = await bcrypt.hash('local-development-only', 12);
    for (const [role, username] of [['MANAGER', 'local_manager'], ['CASHIER', 'local_cashier'], ['KITCHEN', 'local_kitchen'], ['RIDER', 'local_rider']]) {
      await upsertOne(trx, 'merchant_staffs', { merchant_id: firstMerchantId, username }, {
        password_hash: passwordHash, full_name: `Local ${role}`, phone: '0800000000', role,
        is_active: true, updated_at: trx.fn.now(), deleted_at: null,
      });
    }

    // DEV ONLY. This synthetic credential is guarded by the loopback/local database check above.
    const adminPasswordHash = await bcrypt.hash('local-admin-only', 12);
    await upsertOne(trx, 'platform_admins', { username: 'local_super_admin' }, {
      password_hash: adminPasswordHash,
      full_name: 'Local Super Admin',
      email: 'admin@example.invalid',
      role: 'SUPER_ADMIN',
      is_active: true,
      updated_at: trx.fn.now(),
      deleted_at: null,
    });
    const localAdmin = await trx('platform_admins').where({ username: 'local_super_admin' }).first('id');
    await upsertOne(trx, 'coupons', { code: 'WELCOME10' }, {
      name: 'ยินดีต้อนรับ ลด 10%',
      description: 'คูปองตัวอย่างสำหรับ Local Development',
      merchant_id: null,
      funding_source: 'MERCHANT', promotion_type: 'PERCENTAGE',
      value: 10,
      minimum_order_amount: 50,
      maximum_discount_amount: 30,
      starts_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
      ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      usage_limit: 1000,
      per_customer_limit: 100,
      is_active: true,
      created_by_admin_id: localAdmin.id,
      updated_at: trx.fn.now(),
      deleted_at: null,
    });
    await upsertOne(trx, 'promotions', { name: 'ส่งฟรีต้อนรับ Local' }, {
      description: 'โปรโมชันตัวอย่างสำหรับ Local Development',
      merchant_id: null,
      funding_source: 'MERCHANT', promotion_type: 'FREE_DELIVERY',
      value: 0,
      minimum_order_amount: 50,
      maximum_discount_amount: 25,
      starts_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
      ends_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      usage_limit: null,
      is_active: true,
      created_by_admin_id: localAdmin.id,
      updated_at: trx.fn.now(),
      deleted_at: null,
    });

    const bannerObjectKey = 'banners/2026/10/00000000-0000-4000-8000-000000000001.png';
    const storageRoot = path.resolve(process.env.SLIP_STORAGE_DIR || path.join(__dirname, '../storage'));
    const bannerDestination = path.resolve(storageRoot, ...bannerObjectKey.split('/'));
    if (!bannerDestination.startsWith(`${storageRoot}${path.sep}`)) throw new Error('Unsafe local demo banner path.');
    await fs.mkdir(path.dirname(bannerDestination), { recursive: true });
    await fs.copyFile(path.join(__dirname, 'assets/local-demo-banner.png'), bannerDestination);
    await upsertOne(trx, 'banners', { title: 'Local Demo Food Picks' }, {
      image_object_key: bannerObjectKey,
      scope: 'GLOBAL',
      merchant_id: null,
      target_type: 'STORE',
      target_value: String(firstMerchantId),
      status: 'PUBLISHED',
      starts_at: new Date('2026-01-01T00:00:00.000Z'),
      ends_at: new Date('2030-01-01T00:00:00.000Z'),
      sort_order: 1,
      created_by_admin_id: localAdmin.id,
      updated_at: trx.fn.now(),
      deleted_at: null,
    });

    const demoOrderCode = 'DEMO-COMPLETED-001';
    let demoOrder = await trx('orders').where({ order_code: demoOrderCode }).first('id');
    if (!demoOrder) {
      const merchant = await trx('merchants').where({ id: firstMerchantId }).forUpdate().first('last_order_number');
      const merchantOrderNumber = merchant.last_order_number + 1;
      await trx('merchants').where({ id: firstMerchantId }).update({ last_order_number: merchantOrderNumber });
      const address = await trx('customer_addresses').where({ customer_id: customerId, is_default: true })
        .join('dormitories as d', 'd.id', 'customer_addresses.dormitory_id')
        .join('sois as s', 's.id', 'd.soi_id')
        .select('customer_addresses.*', 'd.name as dormitory_name', 'd.location_text', 's.name as soi_name').first();
      const rider = await trx('merchant_staffs').where({ merchant_id: firstMerchantId, role: 'RIDER', is_active: true }).whereNull('deleted_at').first('id');
      const [createdOrder] = await trx('orders').insert({
        order_code: demoOrderCode,
        merchant_order_number: merchantOrderNumber,
        customer_id: customerId,
        merchant_id: firstMerchantId,
        customer_address_id: address.id,
        assigned_rider_id: rider.id,
        delivery_type: 'DELIVERY',
        status: 'COMPLETED',
        payment_method: 'PROMPTPAY',
        payment_status: 'PAID',
        subtotal_amount: 60,
        delivery_fee: 15,
        discount_amount: 0,
        total_amount: 75,
        delivery_address_label: address.label,
        delivery_soi_name: address.soi_name,
        delivery_dormitory_name: address.dormitory_name,
        delivery_location_text: address.location_text,
        delivery_room_number: address.room_number,
        delivery_contact_phone: address.contact_phone,
        delivery_note: 'Local demo completed order',
        accepted_at: trx.fn.now(),
        delivering_at: trx.fn.now(),
        completed_at: trx.fn.now(),
      }).returning('id');
      demoOrder = createdOrder;
      const menuItem = await trx('menu_items').where({ merchant_id: firstMerchantId, name: 'Local Basil Rice' }).first('id');
      await trx('order_items').insert({
        order_id: demoOrder.id,
        merchant_id: firstMerchantId,
        menu_item_id: menuItem.id,
        item_name: 'Local Basil Rice',
        quantity: 1,
        unit_price: 60,
        note: 'Demo order',
        is_completed: true,
      });
      await trx('payments').insert({
        order_id: demoOrder.id,
        method: 'PROMPTPAY',
        status: 'PAID',
        verification_status: 'VERIFIED',
        expected_amount: 75,
        amount_transferred: 75,
        provider: 'LOCAL_DEMO',
        transaction_reference: 'LOCAL-DEMO-TRANSACTION-001',
        verified_at: trx.fn.now(),
        paid_at: trx.fn.now(),
      });
    }
    await upsertOne(trx, 'reviews', { order_id: demoOrder.id }, {
      customer_id: customerId,
      merchant_id: firstMerchantId,
      rating: 5,
      comment: 'อาหารอร่อย ส่งครบ และตรงเวลา',
      status: 'PUBLISHED',
      updated_at: trx.fn.now(),
    });
    await trx('system_settings').insert({
      setting_key: 'platform_display_name',
      setting_value: JSON.stringify('Select Topic 2'),
      is_public: true,
    }).onConflict('setting_key').ignore();
  });
};
