export function bannerTarget(banner) {
  const value = banner?.target_value || '';
  if (['STORE', 'MENU', 'PROMOTION'].includes(banner?.target_type) && /^[1-9]\d*$/.test(value)) {
    const paths = { STORE: 'stores', MENU: 'menu', PROMOTION: 'promotions' };
    return `/${paths[banner.target_type]}/${value}`;
  }
  if (banner?.target_type === 'URL' && !/[\\\s\u0000-\u001f]/.test(value)) {
    if (value.startsWith('/') && !value.startsWith('//')) return value;
    try { if (new URL(value).protocol === 'https:') return value; } catch { /* fallback */ }
  }
  return '#recommended-stores';
}
