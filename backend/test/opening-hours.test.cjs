const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openingStatus } = require('../src/opening-hours.cjs');
test('opening hours Bangkok boundaries, no schedule compatibility, and manual close', () => {
  const hours = [{ day_of_week: 2, is_closed: false, open_time: '09:00:00', close_time: '18:00:00' }];
  assert.equal(openingStatus({ is_open: true }, []), 'OPEN');
  assert.equal(openingStatus({ is_open: true }, hours, new Date('2026-10-06T02:00:00Z')), 'OPEN');
  assert.equal(openingStatus({ is_open: true }, hours, new Date('2026-10-06T11:00:00Z')), 'CLOSED');
  assert.equal(openingStatus({ is_open: false }, hours, new Date('2026-10-06T02:00:00Z')), 'MANUALLY_CLOSED');
  assert.equal(
    openingStatus({ is_open: true }, [{ day_of_week: 2, is_closed: true }], new Date('2026-10-06T02:00:00Z')),
    'CLOSED',
  );
});
