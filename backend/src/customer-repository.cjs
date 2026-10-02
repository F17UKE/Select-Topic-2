const { HttpError } = require('./http.cjs');

function createCustomerRepository(db) {
  const profileColumns = ['id', 'line_user_id', 'display_name', 'profile_image_url', 'phone', 'email'];

  const getProfile = (customerId) => db('customers').select(profileColumns).where({ id: customerId }).first();

  async function updateProfile(customerId, changes) {
    const [profile] = await db('customers')
      .where({ id: customerId, is_active: true })
      .update({ ...changes, updated_at: db.fn.now() })
      .returning(profileColumns);
    if (!profile) throw new HttpError(404, 'customer_not_found');
    return profile;
  }

  const listDormitories = () => db('dormitories as d')
    .join('sois as s', 's.id', 'd.soi_id')
    .select('d.id', 'd.name', 'd.location_text', 's.id as soi_id', 's.name as soi_name')
    .where({ 'd.is_active': true, 's.is_active': true })
    .orderBy([{ column: 's.name' }, { column: 'd.name' }]);

  const listAddresses = (customerId) => db('customer_addresses as a')
    .join('dormitories as d', 'd.id', 'a.dormitory_id')
    .join('sois as s', 's.id', 'd.soi_id')
    .select(
      'a.id', 'a.label', 'a.room_number', 'a.contact_phone', 'a.address_detail',
      'a.is_default', 'a.dormitory_id', 'd.name as dormitory_name',
      'd.location_text', 's.id as soi_id', 's.name as soi_name',
    )
    .where('a.customer_id', customerId)
    .orderBy([{ column: 'a.is_default', order: 'desc' }, { column: 'a.created_at', order: 'asc' }]);

  async function ensureDormitory(trx, dormitoryId) {
    const dormitory = await trx('dormitories as d')
      .join('sois as s', 's.id', 'd.soi_id')
      .where({ 'd.id': dormitoryId, 'd.is_active': true, 's.is_active': true })
      .first('d.id');
    if (!dormitory) throw new HttpError(400, 'invalid_dormitory');
  }

  async function addAddress(customerId, values, makeDefault) {
    return db.transaction(async (trx) => {
      await ensureDormitory(trx, values.dormitory_id);
      const existing = await trx('customer_addresses').where({ customer_id: customerId }).first('id');
      const isDefault = makeDefault || !existing;
      if (isDefault) {
        await trx('customer_addresses').where({ customer_id: customerId }).update({ is_default: false });
      }
      const [created] = await trx('customer_addresses')
        .insert({ customer_id: customerId, ...values, is_default: isDefault })
        .returning('id');
      return created.id;
    });
  }

  async function updateAddress(customerId, addressId, values) {
    return db.transaction(async (trx) => {
      if (values.dormitory_id) await ensureDormitory(trx, values.dormitory_id);
      const [updated] = await trx('customer_addresses')
        .where({ id: addressId, customer_id: customerId })
        .update({ ...values, updated_at: trx.fn.now() })
        .returning('id');
      if (!updated) throw new HttpError(404, 'address_not_found');
      return updated.id;
    });
  }

  async function setDefaultAddress(customerId, addressId) {
    return db.transaction(async (trx) => {
      const address = await trx('customer_addresses')
        .where({ id: addressId, customer_id: customerId }).first('id');
      if (!address) throw new HttpError(404, 'address_not_found');
      await trx('customer_addresses').where({ customer_id: customerId }).update({ is_default: false });
      await trx('customer_addresses').where({ id: addressId }).update({ is_default: true, updated_at: trx.fn.now() });
    });
  }

  return { getProfile, updateProfile, listDormitories, listAddresses, addAddress, updateAddress, setDefaultAddress };
}

module.exports = { createCustomerRepository };
