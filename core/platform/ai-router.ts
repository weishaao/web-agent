// core/platform/ai-router.ts
// AI 平台路由：根据配置和请求环境，选择合适的 AI 平台适配器

import type { AiPlatformAdapter, AiPlatformName } from './ai-platform';

/** 平台注册表 */
const registry = new Map<AiPlatformName, AiPlatformAdapter>();

/** 当前激活的平台 */
let activePlatform: AiPlatformName = 'deepseek-web';

/** 注册一个平台适配器 */
export function registerPlatform(adapter: AiPlatformAdapter): void {
  registry.set(adapter.name, adapter);
}

/** 切换当前平台 */
export function setActivePlatform(name: AiPlatformName): void {
  if (!registry.has(name)) {
    const available = Array.from(registry.keys()).join(', ');
    throw new Error(`Platform '${name}' not registered. Available: ${available}`);
  }
  activePlatform = name;
}

/** 获取当前平台 */
export function getActivePlatform(): AiPlatformAdapter {
  const adapter = registry.get(activePlatform);
  if (!adapter) {
    throw new Error(`Active platform '${activePlatform}' not registered`);
  }
  return adapter;
}

/** 获取指定平台适配器 */
export function getPlatform(name: AiPlatformName): AiPlatformAdapter | undefined {
  return registry.get(name);
}

/** 列出所有已注册平台 */
export function listPlatforms(): AiPlatformName[] {
  return Array.from(registry.keys());
}

/** 代理所有平台方法，简化调用 */
export const platform = new Proxy<Record<string, unknown>>({}, {
  get(_target, prop: string) {
    return (...args: unknown[]) => {
      const adapter = getActivePlatform();
      const method = (adapter as unknown as Record<string, unknown>)[prop];
      if (typeof method === 'function') {
        return method.apply(adapter, args);
      }
      throw new Error(`Method '${prop}' not found on platform '${activePlatform}'`);
    };
  },
});
