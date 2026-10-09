const messages = {
  AMOUNT_MISMATCH: 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ',
  RECIPIENT_MISMATCH: 'ข้อมูลผู้รับเงินในสลิปไม่ตรงกับร้านค้า',
  DUPLICATE_TRANSACTION_REFERENCE: 'สลิปนี้ถูกใช้ไปแล้ว',
  duplicate_slip: 'สลิปนี้ถูกใช้ไปแล้ว',
  PROVIDER_DUPLICATE_REQUIRES_REVIEW: 'สลิปนี้มีประวัติการตรวจสอบแล้ว กรุณาติดต่อร้านค้า',
  INVALID_SLIP: 'ไม่สามารถอ่านข้อมูลจากรูปสลิปนี้ได้ กรุณาเลือกรูปใหม่',
  SLIP_NOT_FOUND: 'ไม่พบข้อมูลสลิปในรูป กรุณาใช้สลิปที่มี QR ชัดเจน',
  SLIP_PENDING: 'ธนาคารกำลังประมวลผลสลิป กรุณารอสักครู่แล้วลองใหม่',
  INVALID_IMAGE_FORMAT: 'ไฟล์รูปไม่ถูกต้อง กรุณาใช้รูปสลิปจากธนาคาร',
  INVALID_IMAGE_TYPE: 'ไฟล์รูปไม่ถูกต้อง กรุณาใช้รูปสลิปจากธนาคาร',
  IMAGE_SIZE_TOO_LARGE: 'รูปสลิปมีขนาดเกิน 4 MB',
  INVALID_API_KEY: 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
  MISSING_API_KEY: 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
  BRANCH_INACTIVE: 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
  SERVICE_BANNED: 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
  SERVICE_DELETED: 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
  SERVICE_EXPIRED: 'แพ็กเกจ EasySlip หมดอายุ กรุณาติดต่อผู้ดูแล',
  USER_BANNED: 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
  IP_NOT_ALLOWED: 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
  QUOTA_EXCEEDED: 'ระบบตรวจสอบสลิปถึงขีดจำกัดชั่วคราว กรุณาติดต่อผู้ดูแล',
  RATE_LIMIT_EXCEEDED: 'ระบบตรวจสอบสลิปกำลังมีผู้ใช้งานมาก กรุณารอสักครู่แล้วลองใหม่',
  API_SERVER_ERROR: 'ไม่สามารถเชื่อมต่อระบบตรวจสอบสลิปได้ กรุณาลองใหม่',
  INTERNAL_SERVER_ERROR: 'ไม่สามารถเชื่อมต่อระบบตรวจสอบสลิปได้ กรุณาลองใหม่',
  EASYSLIP_UNAVAILABLE: 'ไม่สามารถเชื่อมต่อระบบตรวจสอบสลิปได้ กรุณาลองใหม่',
  EASYSLIP_MALFORMED_RESPONSE: 'ไม่สามารถเชื่อมต่อระบบตรวจสอบสลิปได้ กรุณาลองใหม่',
  VALIDATION_ERROR: 'ระบบตรวจสอบการชำระเงินไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแล',
  unsupported_slip_image: 'รองรับเฉพาะรูป JPG, PNG หรือ WebP',
  slip_too_large: 'รูปสลิปมีขนาดเกิน 4 MB',
  merchant_promptpay_invalid: 'ร้านค้ายังไม่พร้อมรับชำระเงิน กรุณาติดต่อร้านค้า',
  payment_recipient_not_configured: 'ร้านค้ายังไม่ได้ตั้งค่าบัญชีรับชำระเงิน',
  retry_original_slip_required: 'กรุณาเลือกรูปสลิปเดิมเพื่อลองตรวจสอบอีกครั้ง',
  payment_verification_in_progress: 'กำลังตรวจสอบการชำระเงิน กรุณารอสักครู่',
};
export function paymentErrorMessage(code) {
  return messages[code] || 'ระบบตรวจสอบการชำระเงินขัดข้องชั่วคราว กรุณาลองอีกครั้ง';
}
export function validateSlipFile(file) {
  if (!file) return 'กรุณาเลือกรูปสลิป';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return messages.unsupported_slip_image;
  if (file.size > 4194304) return 'รูปสลิปมีขนาดเกิน 4 MB กรุณาเลือกรูปใหม่';
  if (!file.size) return messages.unsupported_slip_image;
  return '';
}

// PENDING alone means awaiting a slip in the existing API, not provider processing.
export function paymentNeedsReconciliation(payment) {
  if (!payment || payment.status === 'PAID') return false;
  return ['PROCESSING', 'SUBMITTED', 'VERIFYING', 'PENDING_VERIFICATION'].includes(payment.status)
    || ['PROCESSING', 'VERIFIED'].includes(payment.verification_status)
    || ['PROCESSING', 'VERIFIED'].includes(payment.verification?.status);
}

export function orderPaymentPresentation(order, payment) {
  const paid = order?.payment_status === 'PAID' || payment?.status === 'PAID';
  const processing = !paid && (order?.payment_status === 'PENDING_VERIFICATION'
    || paymentNeedsReconciliation(payment) || payment?.reconciliation_available === true);
  return {
    paid,
    processing,
    status: paid ? 'PAID' : processing ? 'PENDING_VERIFICATION' : order?.payment_status,
    canPay: !paid && !processing && !['CANCELLED', 'REJECTED'].includes(order?.status),
  };
}

export function qrDownloadName(orderCode) {
  const safe = String(orderCode || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'order';
  return `promptpay-${safe}.png`;
}

// Reuses only the server's PNG. No QR generation or client-side amount calculation.
export async function savePaymentQr(imageDataUrl, orderCode, browser = globalThis) {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(imageDataUrl || '')) return 'fallback';
  const filename = qrDownloadName(orderCode);
  try {
    if (browser.navigator?.canShare && browser.navigator?.share && browser.File) {
      const binary = browser.atob(imageDataUrl.split(',')[1]);
      const file = new browser.File([Uint8Array.from(binary, (char) => char.charCodeAt(0))], filename, { type: 'image/png' });
      if (browser.navigator.canShare({ files: [file] })) {
        await browser.navigator.share({ files: [file] });
        return 'shared';
      }
    }
    const link = browser.document.createElement('a');
    if (!('download' in link)) return 'fallback';
    link.href = imageDataUrl; link.download = filename;
    browser.document.body.appendChild(link);
    try { link.click(); } finally { link.remove(); }
    return 'downloaded';
  } catch (error) {
    return error?.name === 'AbortError' ? 'cancelled' : 'fallback';
  }
}
