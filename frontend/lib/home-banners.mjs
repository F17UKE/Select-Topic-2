// Display fallback only. Published API records remain authoritative; no scheduling here.
const demoBanners = [
  { id: 'local-welcome', title: 'ส่งฟรีต้อนรับ', subtitle: 'ขั้นต่ำ ฿50', target_type: 'URL', target_value: '/promotions', demo: true },
  { id: 'local-discount', title: 'ลด 10% ร้านแนะนำ', subtitle: 'สูงสุด ฿30', target_type: 'URL', target_value: '/promotions', demo: true },
  { id: 'local-stores', title: 'ร้านเปิดใหม่ใกล้คุณ', subtitle: 'ลองเมนูใหม่วันนี้', target_type: 'URL', target_value: '/#recommended-stores', demo: true },
];

export function homeBannerSlides(banners, failedImages = [], development = false) {
  const available = banners.filter((banner) => typeof banner.image_url === 'string'
    && banner.image_url.trim() && !failedImages.includes(banner.image_url));
  if (available.length) return available;
  // A production empty/error state must not advertise fictitious discounts.
  return development ? demoBanners : [null];
}
