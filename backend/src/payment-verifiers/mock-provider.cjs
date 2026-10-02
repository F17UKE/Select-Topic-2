const crypto = require('node:crypto');
const { VerificationProviderError } = require('./errors.cjs');

function normalizeIdentifier(value) {
  return String(value || '').replace(/\D/g, '');
}

function createMockProvider({ randomUUID = crypto.randomUUID } = {}) {
  return {
    name: 'mock-checkslip',
    async verify({ expectedAmount, expectedRecipient, fileHash, scenario = 'success', transactionReference }) {
      if (!['success', 'amount_mismatch', 'recipient_mismatch', 'duplicate_reference', 'provider_error'].includes(scenario)) {
        throw new VerificationProviderError('invalid_mock_scenario', { retryable: false });
      }
      if (scenario === 'provider_error') throw new VerificationProviderError('mock_provider_error');
      const reference = transactionReference || `MOCK-${fileHash.slice(0, 24).toUpperCase()}`;
      const amount = scenario === 'amount_mismatch' ? Number(expectedAmount) + 1 : Number(expectedAmount);
      const recipientValue = scenario === 'recipient_mismatch' ? '0999999999' : normalizeIdentifier(expectedRecipient);
      const providerRequestId = randomUUID();
      const normalizedReference = scenario === 'duplicate_reference' && !transactionReference
        ? 'MOCK-DUPLICATE-REFERENCE'
        : reference;
      return {
        status: 'VERIFIED', provider: 'mock-checkslip', providerRequestId,
        transactionReference: normalizedReference, amount,
        recipient: { type: null, value: recipientValue }, failureCode: null,
        rawRedacted: {
          provider: 'mock-checkslip', status: 'VERIFIED', outcome: scenario,
          request_id: providerRequestId, transaction_reference: normalizedReference,
          amount, recipient_last4: recipientValue.slice(-4),
        },
      };
    },
  };
}

module.exports = { createMockProvider };
