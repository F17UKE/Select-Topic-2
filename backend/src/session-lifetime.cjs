// Customer and staff cookies already use an absolute eight-hour lifetime.
const SESSION_SECONDS = 8 * 60 * 60;

function sessionExpired(session, now) {
  const age = now - session.createdAt;
  return !Number.isFinite(age) || age < 0 || age >= SESSION_SECONDS * 1000;
}

module.exports = { SESSION_SECONDS, sessionExpired };
