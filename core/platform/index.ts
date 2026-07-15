// AI Platform Interface — 统一模型后端抽象层
//
// 架构： interceptor → Platform Router → {deepseek-web | deepseek-api | openai-compat | custom}
//
// 使用方式：
//   import { registerPlatform, setActivePlatform, getActivePlatform } from './platform/ai-router';
//   import { DeepSeekWebAdapter } from './platform/adapters/deepseek-web';
//
//   registerPlatform(new DeepSeekWebAdapter());
//   setActivePlatform('deepseek-web');
//   const result = await getActivePlatform().sendChat({ ... });

export type {
  PlatformCapability,
  PlatformCapabilityMap,
  PlatformEnvironment,
  PlatformKind,
} from './capabilities';

export {
  EMPTY_PLATFORM_CAPABILITIES,
  createCapabilityMap,
  getCurrentPlatformEnvironment,
  isCapabilitySupported,
} from './capabilities';

export {
  getSupportedMcpTransportKinds,
  isShellNativeHostSupported,
} from './gating';

// ========== AI Platform Interface 导出 ==========

export { AI_PLATFORMS } from './ai-platform';
export type {
  AiPlatformName,
  AiPlatformAdapter,
  ChatRequest,
  ChatResponse,
  ToolDescriptor,
  ToolCall,
  AiStreamEvent,
  HistoryMessage,
} from './ai-platform';

export {
  registerPlatform,
  setActivePlatform,
  getActivePlatform,
  getPlatform,
  listPlatforms,
} from './ai-router';

export { DeepSeekWebAdapter } from './adapters/deepseek-web';
export { DeepSeekApiAdapter } from './adapters/deepseek-api';
export { OpenAiCompatAdapter } from './adapters/openai-compat';
