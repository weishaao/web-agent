// 平台选择器组件 — 用于设置页
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';

interface PlatformOption {
  value: string;
  label: string;
  description: string;
}

const PLATFORM_OPTIONS: PlatformOption[] = [
  { value: 'deepseek-web', label: 'DeepSeek Web', description: '拦截 chat.deepseek.com 网页版，需登录 DeepSeek 账号' },
  { value: 'deepseek-api', label: 'DeepSeek API', description: '通过 api.deepseek.com 官方 API，需 API Key' },
  { value: 'openai-compat', label: 'OpenAI 兼容', description: '兼容 OpenAI 格式的服务 (Ollama / vLLM / Claude API 等)' },
];

const STORAGE_KEY = 'dpp_ai_platform';

export function PlatformSelector() {
  const { t } = useI18n();
  const [platform, setPlatformState] = useState('deepseek-web');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 读取当前配置
    chrome.storage.local.get(STORAGE_KEY).then((result) => {
      const saved = result[STORAGE_KEY] as string | undefined;
      if (saved && ['deepseek-web', 'deepseek-api', 'openai-compat'].includes(saved)) {
        setPlatformState(saved);
      }
      setLoading(false);
    });
  }, []);

  const handleChange = async (value: string) => {
    setPlatformState(value);
    await chrome.storage.local.set({ [STORAGE_KEY]: value });
    // 通知背景脚本重新初始化平台
    try {
      await chrome.runtime.sendMessage({ type: 'AI_PLATFORM_SWITCHED', payload: { platform: value } });
    } catch {
      // 背景脚本可能未准备好
    }
  };

  const selected = PLATFORM_OPTIONS.find(o => o.value === platform) ?? PLATFORM_OPTIONS[0];

  return (
    <div className="space-y-3">
      <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
        {t('sidepanel.settings.aiPlatform') ?? 'AI 平台'}
      </div>
      <div className="text-[11px]" style={{ color: 'var(--ds-text-tertiary)' }}>
        {t('sidepanel.settings.aiPlatformDescription') ?? '选择 AI 模型后端：'}
      </div>

      {loading ? (
        <div className="text-[11px] text-center py-2" style={{ color: 'var(--ds-text-tertiary)' }}>
          加载中...
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {PLATFORM_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={`
                flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-all duration-150
                ${platform === opt.value
                  ? 'border-2' : 'border border-solid opacity-70 hover:opacity-90'}
              `}
              style={{
                borderColor: platform === opt.value
                  ? 'var(--ds-accent, #4f8bff)'
                  : 'var(--ds-border, #e5e7eb)',
                background: platform === opt.value
                  ? 'color-mix(in srgb, var(--ds-accent, #4f8bff) 10%, transparent)'
                  : 'transparent',
              }}
            >
              <input
                type="radio"
                name="aiPlatform"
                value={opt.value}
                checked={platform === opt.value}
                onChange={() => handleChange(opt.value)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium" style={{ color: 'var(--ds-text)' }}>
                  {opt.label}
                </div>
                <div className="text-[10px] mt-0.5" style={{ color: 'var(--ds-text-tertiary)' }}>
                  {opt.description}
                </div>
              </div>
              {platform === opt.value && (
                <span className="text-[10px] shrink-0" style={{ color: 'var(--ds-accent, #4f8bff)' }}>
                  ✓ 使用中
                </span>
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
