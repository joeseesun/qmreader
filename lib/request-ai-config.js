const SERVER_DEEPSEEK_MODEL = 'deepseek-v4-flash';

function header(req, name) {
  return String(req.get(name) || '').trim();
}

function requestAiConfig(req) {
  const apiKey = header(req, 'x-ai-key') || header(req, 'x-deepseek-key');

  // Never combine the server-owned DeepSeek key with client-controlled routing.
  // Custom providers remain available only when the caller supplies its own key.
  if (!apiKey) {
    return {
      apiKey: '',
      provider: 'deepseek',
      providerName: 'DeepSeek',
      providerType: 'openai_compatible',
      baseUrl: '',
      model: SERVER_DEEPSEEK_MODEL,
      temperature: '',
      maxTokens: '',
    };
  }

  return {
    apiKey,
    provider: header(req, 'x-ai-provider') || 'deepseek',
    providerName: header(req, 'x-ai-provider-name'),
    providerType: header(req, 'x-ai-provider-type') || 'openai_compatible',
    baseUrl: header(req, 'x-ai-base-url'),
    model: header(req, 'x-ai-model'),
    temperature: header(req, 'x-ai-temperature'),
    maxTokens: header(req, 'x-ai-max-tokens'),
  };
}

module.exports = {
  SERVER_DEEPSEEK_MODEL,
  requestAiConfig,
};
