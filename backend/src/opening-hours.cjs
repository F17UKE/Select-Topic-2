function openingStatus(merchant, hours, now = new Date()) {
  if (!merchant.is_open) return 'MANUALLY_CLOSED';
  if (!hours.length) return 'OPEN';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Bangkok',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const slot = hours.find((h) => h.day_of_week === day);
  const time = `${parts.hour}:${parts.minute}:00`;
  return slot && !slot.is_closed && time >= slot.open_time && time < slot.close_time ? 'OPEN' : 'CLOSED';
}
module.exports = { openingStatus };
