function oneOf(value, allowed, name) {
  if (!allowed.includes(value)) throw new Error(`${name} must be ${allowed.join(' or ')}`);
  return value;
}

function lineIntegrationConfig(env = process.env) {
  const authMode = env.CUSTOMER_AUTH_MODE || (env.NODE_ENV === 'production' ? 'line' : 'mock');
  const messagingMode = oneOf(
    env.LINE_MESSAGING_MODE || (env.NODE_ENV === 'production' ? 'real' : 'disabled'),
    ['disabled', 'mock', 'real'],
    'LINE_MESSAGING_MODE',
  );
  const channelId = env.LINE_CHANNEL_ID || '';
  const channelSecret = env.LINE_CHANNEL_SECRET || '';
  const liffId = env.LINE_LIFF_ID || '';
  const accessToken = env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN || '';
  const webhookSecret = env.LINE_WEBHOOK_SECRET || channelSecret;
  if (authMode === 'line' && (!channelId || !liffId)) {
    throw new Error('LINE_CHANNEL_ID and LINE_LIFF_ID are required when CUSTOMER_AUTH_MODE=line');
  }
  if (env.NODE_ENV === 'production' && authMode === 'line' && !webhookSecret) {
    throw new Error('LINE_CHANNEL_SECRET or LINE_WEBHOOK_SECRET is required in production');
  }
  if (messagingMode === 'real' && !accessToken) {
    throw new Error('LINE_MESSAGING_CHANNEL_ACCESS_TOKEN is required when LINE_MESSAGING_MODE=real');
  }
  if (env.NODE_ENV === 'production' && messagingMode === 'mock') {
    throw new Error('Mock LINE Messaging is forbidden in production');
  }
  return {
    channelId,
    channelSecret,
    liffId,
    messagingMode,
    accessToken,
    webhookSecret,
    publicAppUrl: env.APP_PUBLIC_URL || (liffId ? `https://liff.line.me/${liffId}` : 'http://127.0.0.1:3000'),
  };
}

module.exports = { lineIntegrationConfig };
