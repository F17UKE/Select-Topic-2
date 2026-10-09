const { HttpError } = require('./http.cjs');
const { bool, integer, str, fields, money, positiveId } = require('./merchant-validation.cjs');
function catalogManagement({ db, write, owned, permit, paged, imageUrl }) {
  async function categories(staff, q = {}) {
    permit(staff, ['MANAGER', 'CASHIER', 'KITCHEN']);
    return paged(
      db('menu_categories')
        .where({ merchant_id: staff.merchant_id })
        .whereNull('deleted_at')
        .orderBy('sort_order')
        .orderBy('id'),
      q,
    );
  }
  async function saveCategory(staff, id, body, remove = false) {
    return write(
      staff,
      remove ? 'CATEGORY_DELETED' : id ? 'CATEGORY_UPDATED' : 'CATEGORY_CREATED',
      'menu_categories',
      async (trx) => {
        if (id) await owned(trx, 'menu_categories', id, staff);
        if (body.direction !== undefined && !remove) {
          if (![-1, 1].includes(body.direction)) throw new HttpError(400, 'invalid_direction');
          const rows = await trx('menu_categories')
            .where({ merchant_id: staff.merchant_id })
            .whereNull('deleted_at')
            .orderBy('sort_order')
            .orderBy('id');
          const index = rows.findIndex((r) => r.id === id),
            target = index + body.direction;
          if (index < 0) throw new HttpError(404, 'category_not_found');
          if (target >= 0 && target < rows.length) [rows[index], rows[target]] = [rows[target], rows[index]];
          for (let i = 0; i < rows.length; i++)
            await trx('menu_categories')
              .where({ id: rows[i].id })
              .update({ sort_order: i, updated_at: trx.fn.now() });
          return { id };
        }
        const data = remove
          ? { deleted_at: trx.fn.now(), is_active: false }
          : fields(
              body,
              { name: (v) => str(v, 120), is_active: bool, sort_order: (v) => integer(v) },
              id ? [] : ['name'],
            );
        const [result] = id
          ? await trx('menu_categories')
              .where({ id })
              .update({ ...data, updated_at: trx.fn.now() })
              .returning('*')
          : await trx('menu_categories')
              .insert({ ...data, merchant_id: staff.merchant_id })
              .returning('*');
        return result;
      },
    );
  }

  async function menu(staff, q = {}) {
    permit(staff, ['MANAGER', 'CASHIER', 'KITCHEN']);
    const query = db('menu_items as m')
      .join('menu_categories as c', 'c.id', 'm.category_id')
      .select('m.*', 'c.name as category_name')
      .where('m.merchant_id', staff.merchant_id)
      .whereNull('m.deleted_at')
      .orderBy('m.sort_order')
      .orderBy('m.id');
    if (q.search) query.whereILike('m.name', '%' + str(q.search, 180) + '%');
    if (q.category_id) query.where('m.category_id', positiveId(q.category_id));
    if (q.available !== undefined && q.available !== '')
      query.where('m.is_available', q.available === 'true');
    if (q.low_stock === 'true') query.where('m.stock_quantity', '<=', 5);
    return paged(query, q);
  }
  async function menuDetail(staff, id) {
    permit(staff, ['MANAGER', 'CASHIER', 'KITCHEN']);
    const item = await owned(db, 'menu_items', id, staff);
    const groups = await db('menu_option_groups').where({ menu_item_id: id }).orderBy('sort_order');
    for (const group of groups)
      group.choices = await db('menu_option_choices')
        .where({ option_group_id: group.id })
        .orderBy('sort_order');
    return { ...item, option_groups: groups };
  }
  async function saveMenu(staff, id, body, remove = false) {
    return write(
      staff,
      remove ? 'MENU_DELETED' : id ? 'MENU_UPDATED' : 'MENU_CREATED',
      'menu_items',
      async (trx) => {
        const old = id ? await owned(trx, 'menu_items', id, staff) : null;
        const data = remove
          ? { deleted_at: trx.fn.now(), is_available: false }
          : fields(
              body,
              {
                name: (v) => str(v, 180),
                description: (v) => str(v, 5000, true),
                category_id: positiveId,
                price: money,
                stock_delta: (v) => integer(v, -1000000),
                stock_quantity: (v) => (v === null || v === '' ? null : integer(v)),
                is_available: bool,
                sort_order: (v) => integer(v),
                image_url: (v) => (v === null ? null : v === old?.image_url ? v : imageUrl(v, staff, 'menu')),
              },
              id ? [] : ['name', 'category_id', 'price'],
            );
        if (data.category_id) await owned(trx, 'menu_categories', data.category_id, staff);
        if (body.stock_delta !== undefined && !remove) {
          const delta = integer(body.stock_delta, -1000000);
          if (!old || old.stock_quantity === null) throw new HttpError(409, 'set_finite_stock_first');
          data.stock_quantity = integer(old.stock_quantity + delta);
          delete data.stock_delta;
        }
        const [result] = id
          ? await trx('menu_items')
              .where({ id })
              .update({ ...data, updated_at: trx.fn.now() })
              .returning('*')
          : await trx('menu_items')
              .insert({ ...data, merchant_id: staff.merchant_id })
              .returning('*');
        return result;
      },
    );
  }

  async function optionGroup(staff, itemId, id, body, remove = false) {
    return write(
      staff,
      remove ? 'OPTION_GROUP_DELETED' : id ? 'OPTION_GROUP_UPDATED' : 'OPTION_GROUP_CREATED',
      'menu_option_groups',
      async (trx) => {
        await owned(trx, 'menu_items', itemId, staff);
        const old = id ? await trx('menu_option_groups').where({ id, menu_item_id: itemId }).first() : null;
        if (id && !old) throw new HttpError(404, 'option_group_not_found');
        if (remove) {
          const choices = await trx('menu_option_choices').where({ option_group_id: id }).pluck('id');
          await trx('order_item_choices')
            .whereIn('menu_option_choice_id', choices)
            .update({ menu_option_choice_id: null });
          await trx('menu_option_choices').where({ option_group_id: id }).del();
          await trx('menu_option_groups').where({ id }).del();
          return { id };
        }
        const data = fields(
          body,
          {
            name: (v) => str(v, 120),
            is_required: bool,
            min_choices: (v) => integer(v, 0, 30),
            max_choices: (v) => integer(v, 1, 30),
            sort_order: (v) => integer(v),
          },
          id ? [] : ['name'],
        );
        const merged = { is_required: false, min_choices: 0, max_choices: 1, ...old, ...data };
        if (merged.min_choices > merged.max_choices || (merged.is_required && merged.min_choices < 1))
          throw new HttpError(400, 'invalid_choice_limits');
        const [result] = id
          ? await trx('menu_option_groups').where({ id }).update(data).returning('*')
          : await trx('menu_option_groups')
              .insert({ ...data, menu_item_id: itemId })
              .returning('*');
        return result;
      },
    );
  }
  async function optionChoice(staff, itemId, groupId, id, body, remove = false) {
    return write(
      staff,
      remove ? 'OPTION_CHOICE_DELETED' : id ? 'OPTION_CHOICE_UPDATED' : 'OPTION_CHOICE_CREATED',
      'menu_option_choices',
      async (trx) => {
        await owned(trx, 'menu_items', itemId, staff);
        if (!(await trx('menu_option_groups').where({ id: groupId, menu_item_id: itemId }).first()))
          throw new HttpError(404, 'option_group_not_found');
        if (id && !(await trx('menu_option_choices').where({ id, option_group_id: groupId }).first()))
          throw new HttpError(404, 'option_choice_not_found');
        if (remove) {
          await trx('order_item_choices')
            .where({ menu_option_choice_id: id })
            .update({ menu_option_choice_id: null });
          await trx('menu_option_choices').where({ id }).del();
          return { id };
        }
        const data = fields(
          body,
          { name: (v) => str(v, 120), extra_price: money, is_available: bool, sort_order: (v) => integer(v) },
          id ? [] : ['name', 'extra_price'],
        );
        const [result] = id
          ? await trx('menu_option_choices').where({ id }).update(data).returning('*')
          : await trx('menu_option_choices')
              .insert({ ...data, option_group_id: groupId })
              .returning('*');
        return result;
      },
    );
  }
  return { categories, saveCategory, menu, menuDetail, saveMenu, optionGroup, optionChoice };
}
module.exports = { catalogManagement };
