const { HttpError } = require('./http.cjs');
const { bool, integer, str, fields } = require('./merchant-validation.cjs');
const { detectImage } = require('./slip-storage.cjs');
function storeManagement({ db, storage, write, owned, permit }) {
  const publicStore = (row) => {
    const { promptpay_id, ...safe } = row;
    return {
      ...safe,
      promptpay_masked: promptpay_id
        ? `${'*'.repeat(Math.max(0, promptpay_id.length - 4))}${promptpay_id.slice(-4)}`
        : null,
    };
  };
  async function store(staff) {
    permit(staff);
    const row = await db('merchants').where({ id: staff.merchant_id }).first();
    return {
      store: publicStore(row),
      gallery: await db('merchant_images').where({ merchant_id: staff.merchant_id }).orderBy('sort_order'),
      hours: await db('merchant_opening_hours')
        .where({ merchant_id: staff.merchant_id })
        .orderBy('day_of_week'),
    };
  }
  async function saveStore(staff, body) {
    const data = fields(body, {
      store_name: (v) => str(v, 180),
      phone: (v) => str(v, 30),
      location_text: (v) => str(v, 1000),
      is_open: bool,
      promptpay_id: (v) => str(v, 30),
      promptpay_identifier_type: (v) => str(v, 30),
    });
    return write(staff, 'STORE_UPDATED', 'merchants', async (trx) => {
      const row = await trx('merchants').where({ id: staff.merchant_id }).first();
      if (data.promptpay_id !== undefined || data.promptpay_identifier_type !== undefined) {
        const type = data.promptpay_identifier_type || row.promptpay_identifier_type,
          id = data.promptpay_id || row.promptpay_id;
        const patterns = {
          PHONE: /^0\d{9}$/,
          NATIONAL_ID: /^\d{13}$/,
          TAX_ID: /^\d{13}$/,
          EWALLET: /^\d{15}$/,
        };
        if (!patterns[type]?.test(id)) throw new HttpError(400, 'invalid_promptpay');
        if (
          await trx('orders')
            .where({ merchant_id: staff.merchant_id })
            .whereNotIn('status', ['COMPLETED', 'CANCELLED', 'REJECTED'])
            .whereNot('payment_status', 'PAID')
            .first()
        )
          throw new HttpError(409, 'pending_payment_prevents_promptpay_change');
      }
      const [updated] = await trx('merchants')
        .where({ id: staff.merchant_id })
        .update({ ...data, updated_at: trx.fn.now() })
        .returning('*');
      return publicStore(updated);
    });
  }
  async function saveHours(staff, body) {
    if (!body || !Array.isArray(body.hours) || ![0, 7].includes(body.hours.length))
      throw new HttpError(400, 'provide_seven_days_or_empty');
    const rows = body.hours.map((h) => {
      if (!h || typeof h !== 'object') throw new HttpError(400, 'invalid_day');
      const day = integer(h.day_of_week, 0, 6),
        closed = bool(h.is_closed);
      if (
        !closed &&
        (!/^\d{2}:\d{2}$/.test(h.open_time) ||
          !/^\d{2}:\d{2}$/.test(h.close_time) ||
          h.open_time >= h.close_time ||
          h.close_time > '23:59' ||
          h.open_time > '23:59' ||
          Number(h.open_time.slice(3)) > 59 ||
          Number(h.close_time.slice(3)) > 59)
      )
        throw new HttpError(400, 'invalid_opening_hours');
      return {
        merchant_id: staff.merchant_id,
        day_of_week: day,
        is_closed: closed,
        open_time: closed ? null : h.open_time,
        close_time: closed ? null : h.close_time,
      };
    });
    if (new Set(rows.map((r) => r.day_of_week)).size !== rows.length)
      throw new HttpError(400, 'duplicate_day');
    return write(staff, 'STORE_HOURS_UPDATED', 'merchant_opening_hours', async (trx) => {
      await trx('merchant_opening_hours').where({ merchant_id: staff.merchant_id }).del();
      if (rows.length) await trx('merchant_opening_hours').insert(rows);
      return { hours: rows };
    });
  }
  async function upload(staff, namespace, file) {
    permit(staff);
    if (
      !['menu', 'merchant'].includes(namespace) ||
      !file ||
      file.size > 5 * 1024 * 1024 ||
      detectImage(file.buffer)?.contentType !== file.mimetype
    )
      throw new HttpError(400, 'invalid_image');
    const saved = await storage.put({
      namespace,
      merchantId: staff.merchant_id,
      buffer: file.buffer,
      contentType: file.mimetype,
    });
    try {
      return await write(staff, 'IMAGE_UPLOADED', namespace, async () => ({
        image_url: `/api/catalog/images/${saved.objectKey}`,
      }));
    } catch (error) {
      await storage.remove(saved.objectKey).catch(() => {});
      throw error;
    }
  }
  function imageUrl(value, staff, namespace) {
    const url = str(value, 2048);
    if (
      !new RegExp(
        `^/api/catalog/images/${namespace}/${staff.merchant_id}/[0-9a-f-]{36}\\.(png|jpg|webp)$`,
        'i',
      ).test(url)
    )
      throw new HttpError(400, 'invalid_owned_image');
    return url;
  }
  async function gallery(staff, id, body, remove = false) {
    return write(
      staff,
      remove ? 'STORE_IMAGE_REMOVED' : 'STORE_IMAGE_UPDATED',
      'merchant_images',
      async (trx) => {
        if (id) await owned(trx, 'merchant_images', id, staff);
        if (remove) {
          await trx('merchant_images').where({ id }).del();
          return { id };
        }
        const data = fields(
          body,
          {
            image_url: (v) => imageUrl(v, staff, 'merchant'),
            alt_text: (v) => str(v, 255, true),
            sort_order: (v) => integer(v),
            is_primary: bool,
          },
          id ? [] : ['image_url'],
        );
        if (data.is_primary)
          await trx('merchant_images')
            .where({ merchant_id: staff.merchant_id })
            .update({ is_primary: false });
        const [result] = id
          ? await trx('merchant_images').where({ id }).update(data).returning('*')
          : await trx('merchant_images')
              .insert({ ...data, merchant_id: staff.merchant_id })
              .returning('*');
        return result;
      },
    );
  }
  async function image(key) {
    if (!/^(menu|merchant)\/[1-9]\d*\/[0-9a-f-]{36}\.(png|jpg|webp)$/i.test(key))
      throw new HttpError(404, 'image_not_found');
    const [ns, merchantId] = key.split('/');
    const table = ns === 'menu' ? 'menu_items' : 'merchant_images';
    let q = db(table).where({ merchant_id: merchantId, image_url: `/api/catalog/images/${key}` });
    if (ns === 'menu') q = q.whereNull('deleted_at');
    if (!(await q.first())) throw new HttpError(404, 'image_not_found');
    try {
      return await storage.read(key);
    } catch {
      throw new HttpError(404, 'image_not_found');
    }
  }
  return { store, saveStore, saveHours, upload, gallery, image, imageUrl };
}
module.exports = { storeManagement };
