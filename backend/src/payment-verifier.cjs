const { VerificationProviderError } = require('./payment-verifiers/errors.cjs');
const { createMockProvider } = require('./payment-verifiers/mock-provider.cjs');
const { createCheckslipProvider } = require('./payment-verifiers/checkslip-provider.cjs');

function normalizeIdentifier(value) {
  return String(value || '').replace(/\D/g, '');
}

function identifiersMatch(actual, expected) {
  const normalizedActual = String(actual || '').replace(/[^0-9Xx*]/g, '');
  const normalizedExpected = normalizeIdentifier(expected);
  if (!normalizedActual || normalizedActual.length !== normalizedExpected.length) return false;
  return [...normalizedActual].every((character, index) => (
    character === 'X' || character === 'x' || character === '*' || character === normalizedExpected[index]
  ));
}

function createPaymentVerifier(config, dependencies) {
  return config.verificationMode === 'mock'
    ? createMockProvider(dependencies)
    : createCheckslipProvider(config, dependencies);
}

module.exports = { VerificationProviderError, createPaymentVerifier, identifiersMatch, normalizeIdentifier };
