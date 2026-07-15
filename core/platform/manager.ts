// core/platform/manager.ts
// Platform Manager — 平台生命周期管理，持久化 + 初始化 + 切换通知

import {
  registerPlatform,
  setActivePlatform,
  getActivePlatform,
} from './ai-router';

import { DeepSeekWebAdapter } from './adapters/deepseek-web';
import { DeepSeekApiAdapter } from './adapters/deepseek-api';
import { OpenAiCompatAdapter } from './adapters/openai-compat';
import type { AiPlatformName, AiPlatformAdapter } from './ai-platform';

export type { AiPlatformName, AiPlatformAdapter };

// ==================== 存储键 ====================

const STORAGE_KEY = 'dpp_ai_platform';
const API_KEY_KEY = 'dpp_deepseek_api_key';
const COMPAT_BASE_URL_KEY = 'dpp_compat_base_url';
const COMPAT_MODEL_KEY = 'dpp_compat_model';

// ==================== 持久化设置接口 ====================

export interface PlatformSettings {
  /** 当前选中的平台 */
  platform: AiPlatformName;
  /** DeepSeek API Key (用于 deepseek-api) */
  apiKey: string;
  /** OpenAI 兼容 Base URL (用于 openai-compat) */
  compatBaseUrl: string;
  /** OpenAI 兼容模型名 (用于 openai-compat) */
  compatModel: string;
}

const DEFAULT_SETTINGS: PlatformSettings = {
  platform: 'deepseek-web',
  apiKey: '',
  compatBaseUrl: 'http://localhost:11434/v1',
  compatModel: 'qwen2.5',
};

// ==================== 存储操作 ====================

/** 从 storage 读取平台设置 */
export async function loadPlatformSettings(): Promise<PlatformSettings> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const result = await chrome.storage.local.get([
      STORAGE_KEY, API_KEY_KEY, COMPAT_BASE_URL_KEY, COMPAT_MODEL_KEY,
    ]);
    return {
      platform: (result[STORAGE_KEY] as AiPlatformName) ?? DEFAULT_SETTINGS.platform,
      apiKey: (result[API_KEY_KEY] as string) ?? DEFAULT_SETTINGS.apiKey,
      compatBaseUrl: (result[COMPAT_BASE_URL_KEY] as string) ?? DEFAULT_SETTINGS.compatBaseUrl,
      compatModel: (result[COMPAT_MODEL_KEY] as string) ?? DEFAULT_SETTINGS.compatModel,
    };
  }
  return { ...DEFAULT_SETTINGS };
}

/** 写入平台设置到 storage */
export async function savePlatformSettings(settings: Partial<PlatformSettings>): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    const entries: Record<string, unknown> = {};
    if (settings.platform !== undefined) entries[STORAGE_KEY] = settings.platform;
    if (settings.apiKey !== undefined) entries[API_KEY_KEY] = settings.apiKey;
    if (settings.compatBaseUrl !== undefined) entries[COMPAT_BASE_URL_KEY] = settings.compatBaseUrl;
    if (settings.compatModel !== undefined) entries[COMPAT_MODEL_KEY] = settings.compatModel;
    await chrome.storage.local.set(entries);
  }
}

// ==================== 平台初始化 ====================

let initialized = false;

/**
 * 初始化所有平台适配器并激活配置的平台
 * 应在应用启动时调用一次
 */
export async function initializePlatform(): Promise<void> {
  if (initialized) return;

  // 1. 注册所有平台
  registerPlatform(new DeepSeekWebAdapter());
  // 注意：deepseek-api 和 openai-compat 需要用户配置 API Key

  // 2. 读取配置
  const settings = await loadPlatformSettings();

  // 3. 激活配置的平台
  // 如果目标平台需要 API Key 但未配置，回退到 deepseek-web
  if (settings.platform === 'deepseek-api' && !settings.apiKey) {
    console.warn('[Platform] deepseek-api selected but no API key configured, falling back to deepseek-web');
    await savePlatformSettings({ platform: 'deepseek-web' });
    setActivePlatform('deepseek-web');
  } else if (settings.platform === 'deepseek-api') {
    // 注册带 API Key 的适配器
    registerPlatform(new DeepSeekApiAdapter({ apiKey: settings.apiKey }));
    setActivePlatform('deepseek-api');
  } else if (settings.platform === 'openai-compat') {
    registerPlatform(new OpenAiCompatAdapter({
      apiKey: settings.apiKey,
      baseUrl: settings.compatBaseUrl,
      model: settings.compatModel,
    }));
    setActivePlatform('openai-compat');
  } else {
    setActivePlatform('deepseek-web');
  }

  initialized = true;
  console.log(`[Platform] Initialized: ${getActivePlatform().name}`);
}

/**
 * 切换平台并持久化
 */
export async function switchPlatform(name: AiPlatformName, extra?: {
  apiKey?: string;
  compatBaseUrl?: string;
  compatModel?: string;
}): Promise<void> {
  const settings = await loadPlatformSettings();

  switch (name) {
    case 'deepseek-web':
      setActivePlatform('deepseek-web');
      break;

    case 'deepseek-api': {
      const apiKey = extra?.apiKey ?? settings.apiKey;
      registerPlatform(new DeepSeekApiAdapter({ apiKey }));
      setActivePlatform('deepseek-api');
      if (extra?.apiKey) await savePlatformSettings({ apiKey: extra.apiKey });
      break;
    }

    case 'openai-compat': {
      const apiKey = extra?.apiKey ?? settings.apiKey;
      const baseUrl = extra?.compatBaseUrl ?? settings.compatBaseUrl;
      const model = extra?.compatModel ?? settings.compatModel;
      registerPlatform(new OpenAiCompatAdapter({ apiKey, baseUrl, model }));
      setActivePlatform('openai-compat');
      if (extra?.apiKey) await savePlatformSettings({ apiKey: extra.apiKey });
      if (extra?.compatBaseUrl) await savePlatformSettings({ compatBaseUrl: extra.compatBaseUrl });
      if (extra?.compatModel) await savePlatformSettings({ compatModel: extra.compatModel });
      break;
    }
  }

  await savePlatformSettings({ platform: name });
  console.log(`[Platform] Switched to: ${name}`);
}

/** 判断当前平台是否为 DeepSeek Web（需要拦截器） */
export function isDeepSeekWebMode(): boolean {
  try {
    return getActivePlatform().name === 'deepseek-web';
  } catch {
    return true; // 默认回退安全
  }
}
