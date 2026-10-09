const bcrypt = require('bcryptjs');
const { HttpError } = require('./http.cjs');
const { bool, str, fields } = require('./merchant-validation.cjs');
const STAFF_FIELDS = [
  'id',
  'merchant_id',
  'username',
  'full_name',
  'phone',
  'role',
  'is_active',
  'created_at',
  'updated_at',
];
function staffManagement({ db, write, owned, permit, paged, staffAuth }) {
  async function staffList(staff, q = {}) {
    permit(staff);
    const query = db('merchant_staffs')
      .select(STAFF_FIELDS)
      .where({ merchant_id: staff.merchant_id })
      .whereNull('deleted_at')
      .orderBy('id');
    if (q.role) query.where('role', q.role);
    if (q.search) query.whereILike('full_name', '%' + str(q.search, 160) + '%');
    return paged(query, q);
  }
  async function saveStaff(staff, id, body) {
    permit(staff);
    const data = fields(
      body,
      {
        username: (v) => {
          if (typeof v !== 'string' || !/^[a-zA-Z0-9_.-]{3,80}$/.test(v))
            throw new HttpError(400, 'invalid_username');
          return v;
        },
        full_name: (v) => str(v, 160),
        phone: (v) => str(v, 30, true),
        role: (v) => {
          if (!['MANAGER', 'CASHIER', 'KITCHEN', 'RIDER'].includes(v))
            throw new HttpError(400, 'invalid_role');
          return v;
        },
        is_active: bool,
        password: (v) => {
          if (typeof v !== 'string' || v.length < 12 || Buffer.byteLength(v) > 72)
            throw new HttpError(400, 'password_requires_12_to_72_bytes');
          return v;
        },
      },
      id ? [] : ['username', 'full_name', 'role', 'password'],
    );
    const reset = data.password !== undefined;
    if (reset) {
      data.password_hash = await bcrypt.hash(data.password, 12);
      delete data.password;
    }
    const result = await write(
      staff,
      reset && id ? 'STAFF_PASSWORD_RESET' : id ? 'STAFF_UPDATED' : 'STAFF_CREATED',
      'merchant_staffs',
      async (trx) => {
        // Match assignment's rider-row lock before inspecting active jobs.
        if (id)
          await trx('merchant_staffs').where({ id, merchant_id: staff.merchant_id }).forUpdate().first();
        const old = id ? await owned(trx, 'merchant_staffs', id, staff) : null;
        if (
          old?.role === 'MANAGER' &&
          old.is_active &&
          (data.is_active === false || (data.role && data.role !== 'MANAGER'))
        ) {
          const count = await trx('merchant_staffs')
            .where({ merchant_id: staff.merchant_id, role: 'MANAGER', is_active: true })
            .whereNull('deleted_at')
            .count('* as count')
            .first();
          if (Number(count.count) <= 1) throw new HttpError(409, 'last_manager_required');
        }
        if (
          old?.role === 'RIDER' &&
          (data.is_active === false || (data.role && data.role !== 'RIDER')) &&
          (await trx('orders')
            .where({ merchant_id: staff.merchant_id, assigned_rider_id: id })
            .whereIn('status', ['READY', 'DELIVERING'])
            .first())
        )
          throw new HttpError(409, 'rider_has_active_jobs');
        const [row] = id
          ? await trx('merchant_staffs')
              .where({ id })
              .update({ ...data, updated_at: trx.fn.now() })
              .returning(STAFF_FIELDS)
          : await trx('merchant_staffs')
              .insert({ ...data, merchant_id: staff.merchant_id })
              .returning(STAFF_FIELDS);
        return row;
      },
    );
    if (id && (reset || data.is_active !== undefined || data.role !== undefined)) staffAuth.revokeStaff(id);
    return result;
  }

  async function riders(staff, q = {}) {
    permit(staff);
    const list = await staffList(staff, { ...q, role: 'RIDER' });
    for (const rider of list.items) {
      rider.jobs = await db('orders')
        .where({ merchant_id: staff.merchant_id, assigned_rider_id: rider.id })
        .whereIn('status', ['READY', 'DELIVERING'])
        .select('id', 'order_code', 'status')
        .orderBy('id')
        .limit(50);
      rider.completed_today = Number(
        (
          await db('orders')
            .where({ merchant_id: staff.merchant_id, assigned_rider_id: rider.id, status: 'COMPLETED' })
            .where(
              'completed_at',
              '>=',
              db.raw("date_trunc('day',now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'"),
            )
            .count('* as count')
            .first()
        ).count,
      );
      rider.availability = !rider.is_active ? 'OFFLINE' : rider.jobs.length ? 'BUSY' : 'AVAILABLE';
    }
    return list;
  }
  async function riderHistory(staff, id, q = {}) {
    permit(staff);
    const rider = await owned(db, 'merchant_staffs', id, staff);
    if (rider.role !== 'RIDER') throw new HttpError(404, 'rider_not_found');
    return paged(
      db('orders')
        .where({ merchant_id: staff.merchant_id, assigned_rider_id: id })
        .select('id', 'order_code', 'status', 'created_at', 'completed_at')
        .orderBy('id', 'desc'),
      q,
    );
  }
  return { staffList, saveStaff, riders, riderHistory };
}
module.exports = { staffManagement };
