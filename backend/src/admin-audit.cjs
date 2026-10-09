const REDACTED_KEYS = /password|secret|token|authorization|cookie|api[_-]?key|credential/i;

function redact(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 500
    ? `${value.slice(0, 500)}…` : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    REDACTED_KEYS.test(key) ? '[REDACTED]' : redact(item, depth + 1),
  ]));
}

function createAdminAudit(db) {
  async function append({ actorType = 'ADMIN', actorId = null, action, entityType, entityId = null, requestId = null, ip = null, metadata = {} }, transaction = db) {
    await transaction('audit_logs').insert({
      actor_type: actorType,
      actor_id: actorId,
      action,
      entity_type: entityType,
      entity_id: entityId === null ? null : String(entityId),
      request_id: requestId,
      ip_address: ip,
      metadata: JSON.stringify(redact(metadata)),
    });
  }
  return { append };
}

module.exports = { createAdminAudit, redact };
