// tests/platform-router.test.ts
// Platform Interface 核心逻辑验证

import { describe, it, expect } from 'vitest';
import { registerPlatform, setActivePlatform, getActivePlatform, listPlatforms } from '../core/platform/ai-router';
import { isDeepSeekWebMode } from '../core/platform/manager';
import { DeepSeekWebAdapter } from '../core/platform/adapters/deepseek-web';
import { DeepSeekApiAdapter } from '../core/platform/adapters/deepseek-api';
import { OpenAiCompatAdapter } from '../core/platform/adapters/openai-compat';

describe('AI 平台适配器', () => {

  it('deepseek-web 适配器基本属性', () => {
    const adapter = new DeepSeekWebAdapter();
    expect(adapter.name).toBe('deepseek-web');
    expect(adapter.supportsThinking).toBe(true);
    expect(adapter.supportsSearch).toBe(true);
    expect(adapter.supportsFileUpload).toBe(true);
    expect(adapter.supportedModels.length).toBeGreaterThan(0);
  });

  it('deepseek-api 适配器接受 API Key', () => {
    const adapter = new DeepSeekApiAdapter({ apiKey: 'sk-test-key' });
    expect(adapter.name).toBe('deepseek-api');
    expect(adapter.supportsThinking).toBe(true);
    expect(adapter.supportsSearch).toBe(false);
    expect(adapter.supportsFileUpload).toBe(false);
  });

  it('openai-compat 适配器可配置 Base URL', () => {
    const adapter = new OpenAiCompatAdapter({
      apiKey: '',
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5',
    });
    expect(adapter.name).toBe('openai-compat');
    expect(typeof adapter.streamChat).toBe('function');
    expect(typeof adapter.sendChat).toBe('function');
  });

  it('路由注册和切换', () => {
    // 清空已注册（测试环境是隔离的）
    registerPlatform(new DeepSeekWebAdapter());
    setActivePlatform('deepseek-web');

    const active = getActivePlatform();
    expect(active.name).toBe('deepseek-web');

    // 列出所有已注册平台
    const platforms = listPlatforms();
    expect(platforms).toContain('deepseek-web');
  });

  it('deepseek-web 模式下 isDeepSeekWebMode 返回 true', () => {
    setActivePlatform('deepseek-web');
    expect(isDeepSeekWebMode()).toBe(true);
  });

  it('adapters 实现 streamChat 方法', async () => {
    const web = new DeepSeekWebAdapter();
    const api = new DeepSeekApiAdapter({ apiKey: 'sk-test' });
    const compat = new OpenAiCompatAdapter({
      apiKey: '', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5',
    });

    for (const adapter of [web, api, compat]) {
      expect(typeof adapter.streamChat).toBe('function');
      expect(typeof adapter.sendChat).toBe('function');
      expect(typeof adapter.createSession).toBe('function');
      expect(typeof adapter.serializeTools).toBe('function');
      expect(typeof adapter.deserializeToolCalls).toBe('function');
    }
  });
});
