const { HttpError } = require('./http.cjs');
const { bool, money } = require('./merchant-validation.cjs');
function deliveryManagement({ db, write, permit, paged }) {
  async function fees(staff, q = {}) {
    permit(staff);
    return paged(
      db('sois as s')
        .leftJoin('delivery_fees as f', function () {
          this.on('f.soi_id', 's.id').andOn('f.merchant_id', '=', db.raw('?', [staff.merchant_id]));
        })
        .where('s.is_active', true)
        .select('s.id as soi_id', 's.name', 'f.fee')
        .orderBy('s.name'),
      q,
    );
  }
  async function saveFee(staff, soiId, body) {
    return write(staff, 'DELIVERY_FEE_UPDATED', 'delivery_fees', async (trx) => {
      if (!(await trx('sois').where({ id: soiId, is_active: true }).first()))
        throw new HttpError(404, 'soi_not_found');
      if (!bool(body.enabled)) {
        await trx('delivery_fees').where({ merchant_id: staff.merchant_id, soi_id: soiId }).del();
        return { soi_id: soiId, enabled: false };
      }
      const [row] = await trx('delivery_fees')
        .insert({ merchant_id: staff.merchant_id, soi_id: soiId, fee: money(body.fee) })
        .onConflict(['merchant_id', 'soi_id'])
        .merge(['fee'])
        .returning('*');
      return row;
    });
  }
  return { fees, saveFee };
}
module.exports = { deliveryManagement };
