const test = require('node:test');
const assert = require('node:assert/strict');

const { requestAiConfig } = require('../lib/request-ai-config');

function request(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value])
  );
  return {
    get(name) {
      return normalized[name.toLowerCase()] || '';
    },
  };
}

test('server-funded requests ignore client provider, base URL, model, and tuning headers', () => {
  const config = requestAiConfig(request({
    'x-ai-provider': 'deepseek',
    'x-ai-base-url': 'https://attacker.example/v1',
    'x-ai-model': 'deepseek-v4-pro',
    'x-ai-temperature': '2',
    'x-ai-max-tokens': '32768',
  }));

  assert.deepEqual(config, {
    apiKey: '',
    provider: 'deepseek',
    providerName: 'DeepSeek',
    providerType: 'openai_compatible',
    baseUrl: '',
    model: 'deepseek-v4-flash',
    temperature: '',
    maxTokens: '',
  });
});

test('BYOK requests preserve the caller-owned provider configuration', () => {
  const config = requestAiConfig(request({
    'x-ai-key': 'caller-owned-test-key',
    'x-ai-provider': 'openai-compatible',
    'x-ai-provider-name': 'Caller gateway',
    'x-ai-provider-type': 'openai_compatible',
    'x-ai-base-url': 'https://gateway.example/v1',
    'x-ai-model': 'caller-model',
    'x-ai-temperature': '0.4',
    'x-ai-max-tokens': '1200',
  }));

  assert.equal(config.apiKey, 'caller-owned-test-key');
  assert.equal(config.provider, 'openai-compatible');
  assert.equal(config.baseUrl, 'https://gateway.example/v1');
  assert.equal(config.model, 'caller-model');
  assert.equal(config.maxTokens, '1200');
});
