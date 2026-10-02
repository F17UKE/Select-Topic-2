class VerificationProviderError extends Error {
  constructor(code = 'provider_error', { providerRequestId = null, httpStatus = null, retryable = true } = {}) {
    super(code);
    this.name = 'VerificationProviderError';
    this.code = code;
    this.providerRequestId = providerRequestId;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

module.exports = { VerificationProviderError };
