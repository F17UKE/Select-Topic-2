class LineMessagingError extends Error {
  constructor(code) { super(code); this.name = 'LineMessagingError'; this.code = code; }
}

function createLineMessagingService({ config, fetchImpl = fetch, provider } = {}) {
  async function push(to, message) {
    if (config.messagingMode === 'disabled') return { sent: false, disabled: true };
    if (provider) return provider.push(to, message);
    if (config.messagingMode === 'mock') return { sent: true, mock: true };
    let response;
    try {
      response = await fetchImpl('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, messages: [message] }),
        signal: AbortSignal.timeout(5000),
      });
    } catch { throw new LineMessagingError('line_messaging_unavailable'); }
    if (!response.ok) throw new LineMessagingError('line_messaging_rejected');
    return { sent: true };
  }
  return { push };
}

module.exports = { createLineMessagingService, LineMessagingError };
