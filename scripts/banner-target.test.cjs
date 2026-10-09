const { test } = require('node:test');
const assert = require('node:assert/strict');
test('banner targets support store/menu/promotion/safe URL and reject unsafe URLs', async () => {
  const { bannerTarget } = await import('../frontend/lib/banner-target.mjs');
  for (const [type, prefix] of [['STORE', 'stores'], ['MENU', 'menu'], ['PROMOTION', 'promotions']]) {
    assert.equal(bannerTarget({ target_type: type, target_value: '123' }), `/${prefix}/123`);
    assert.equal(bannerTarget({ target_type: type, target_value: '../evil' }), '#recommended-stores');
  }
  for (const value of ['/stores/1', 'https://example.com/promo']) assert.equal(bannerTarget({ target_type: 'URL', target_value: value }), value);
  for (const value of ['javascript:alert(1)', '//evil.test', '/\\evil.test', '/\nevil.test', 'http://example.com']) {
    assert.equal(bannerTarget({ target_type: 'URL', target_value: value }), '#recommended-stores');
  }
  assert.equal(bannerTarget(null), '#recommended-stores');
});
