const eventCopy = {
  PAYMENT_VERIFIED: ['ชำระเงินสำเร็จ', 'ระบบตรวจสอบการชำระเงินแล้ว'],
  ORDER_ACCEPTED: ['ร้านรับออเดอร์แล้ว', 'ร้านยืนยันและกำลังดำเนินการ'],
  PREPARING: ['กำลังเตรียมอาหาร', 'ร้านเริ่มเตรียมออเดอร์ของคุณแล้ว'],
  READY: ['อาหารพร้อมแล้ว', 'ออเดอร์พร้อมรับหรือรอจัดส่ง'],
  DELIVERING: ['กำลังจัดส่ง', 'ไรเดอร์กำลังนำออเดอร์ไปส่ง'],
  COMPLETED: ['ส่งสำเร็จ', 'ออเดอร์เสร็จสมบูรณ์แล้ว'],
  REJECTED: ['ร้านไม่สามารถรับออเดอร์ได้', 'กรุณาเปิดดูรายละเอียดออเดอร์'],
};

function text(value, size = 'sm', weight) {
  return { type: 'text', text: String(value), size, wrap: true, ...(weight ? { weight } : {}) };
}

function buildOrderFlexMessage(event, order, publicAppUrl) {
  const copy = eventCopy[event];
  if (!copy) throw new Error(`Unsupported LINE order event: ${event}`);
  const base = String(publicAppUrl).replace(/\/$/, '');
  const body = [
    text(copy[0], 'xl', 'bold'),
    text(copy[1]),
    { type: 'separator', margin: 'lg' },
    { type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm', contents: [
      text(`ออเดอร์ ${order.order_code}`, 'md', 'bold'),
      text(order.store_name),
      text(`สถานะ: ${event}`),
      ...(event === 'PAYMENT_VERIFIED' || event === 'ORDER_ACCEPTED' || event === 'REJECTED'
        ? [text(`ยอดรวม ฿${Number(order.total_amount).toFixed(2)}`)] : []),
    ] },
  ];
  return {
    type: 'flex',
    altText: `${copy[0]} · ${order.order_code}`,
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', spacing: 'md', contents: body },
      footer: { type: 'box', layout: 'vertical', contents: [{
        type: 'button', style: 'primary', color: '#8f1d1d',
        action: { type: 'uri', label: 'ดูสถานะออเดอร์', uri: `${base}/orders/${order.id}` },
      }] },
    },
  };
}

module.exports = { buildOrderFlexMessage, eventCopy };
