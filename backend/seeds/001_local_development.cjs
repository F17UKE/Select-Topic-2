const bcrypt = require('bcryptjs');

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
          ] },
          { name: 'Drinks', items: [
            { name: 'Thai Milk Tea', description: 'Freshly brewed and lightly sweet', image: '/demo/thai-tea.svg', price: 40, stock: 30, groups: [{ name: 'Sweetness', required: true, min: 1, max: 1, choices: [{ name: 'No sugar', price: 0 }, { name: 'Half sweet', price: 0 }, { name: 'Regular', price: 0 }] }] },
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
          ] },
          { name: 'Sides', items: [
            { name: 'Crispy Wontons', description: 'Six golden wontons with sweet chilli dip', image: '/demo/wontons.svg', price: 45, stock: 8 },
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
          ] },
          { name: 'Smoothies', items: [
            { name: 'Mango Oat Smoothie', description: 'Mango, oat milk and banana', image: '/demo/mango-smoothie.svg', price: 65, stock: 15 },
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
  });
};
