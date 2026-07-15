// core/platform/adapters/deepseek-api.ts
// DeepSeek 官方 API 适配器 — 通过 api.deepseek.com 官方 API 工作
// 不依赖 DeepSeek Web 页面，使用 API Key 认证

import type {
  AiPlatformAdapter,
  AiPlatformName,
  ChatRequest,
  ChatResponse,
  ToolDescriptor,
  ToolCall,
  AiStreamEvent,
  HistoryMessage,
} from '../ai-platform';

const DEEPSEEK_API_BASE = 'https://api.deepseek.com';

export const NAME: AiPlatformName = 'deepseek-api';

interface DeepSeekApiConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * DeepSeek 官方 API 适配器
 *
 * 使用 OpenAI 兼容的 API 格式与 DeepSeek 官方 API 通信
 * 支持：/v1/chat/completions
 */
export class DeepSeekApiAdapter implements AiPlatformAdapter {
  readonly name = NAME;
  readonly supportedModels = ['deepseek-chat', 'deepseek-reasoner'];
  readonly supportsThinking = true;
  readonly supportsSearch = false; // 官方 API 不支持联网搜索
  readonly supportsFileUpload = false;

  private config: DeepSeekApiConfig;

  constructor(config: DeepSeekApiConfig) {
    this.config = {
      baseUrl: DEEPSEEK_API_BASE,
      ...config,
    };
  }

  setTools(_tools: ToolDescriptor[]): void {
    // 官方 API 通过 tool_choice / tools 参数注入，不需要额外操作
  }

  // ==================== 对话 API ====================

  async sendChat(req: ChatRequest): Promise<ChatResponse> {
    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const body = this.buildRequestBody(req);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getAuthHeaders(),
      body: JSON.stringify(body),
    });

    const data = await response.json() as any;
    const choice = data?.choices?.[0];
    const message = choice?.message;

    return {
      content: message?.content ?? '',
      toolCalls: this.parseOpenAiToolCalls(message?.tool_calls),
      usage: data?.usage ? {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  async *streamChat(req: ChatRequest): AsyncIterable<AiStreamEvent> {
    const url = `${this.config.baseUrl}/v1/chat/completions`;
    const body = this.buildRequestBody(req, true);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.getAuthHeaders(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.body) {
      yield { type: 'error', message: 'Response body is null' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            yield { type: 'finished', reason: 'stop' };
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            const choice = parsed?.choices?.[0];
            const delta = choice?.delta;

            if (delta?.content) {
              yield { type: 'text', text: delta.content };
            }
            if (delta?.reasoning_content) {
              yield { type: 'reasoning', text: delta.reasoning_content };
            }
            if (delta?.tool_calls) {
              yield {
                type: 'tool_call',
                calls: this.parseOpenAiToolCalls(delta.tool_calls),
              };
            }
            if (choice?.finish_reason) {
              yield { type: 'finished', reason: choice.finish_reason };
            }
            if (parsed?.usage) {
              yield {
                type: 'usage',
                tokens: {
                  inputTokens: parsed.usage.prompt_tokens,
                  outputTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens,
                },
              };
            }
          } catch {
            // 跳过解析失败的行
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ==================== 工具调用格式 ====================

  serializeTools(tools: ToolDescriptor[]): unknown {
    return tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  deserializeToolCalls(response: unknown): ToolCall[] {
    // OpenAI 格式的工具调用
    return this.parseOpenAiToolCalls(response);
  }

  // ==================== 会话管理 ====================

  async createSession(): Promise<string> {
    // 官方 API 无状态，用时间戳当 session ID
    return `session_${Date.now()}`;
  }

  async getSessionHistory(_sessionId: string): Promise<HistoryMessage[]> {
    // 官方 API 不管理会话历史
    return [];
  }

  // ==================== 认证 ====================

  getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  // ==================== 内部方法 ====================

  private buildRequestBody(req: ChatRequest, stream = false): Record<string, unknown> {
    return {
      model: req.modelType ?? 'deepseek-chat',
      messages: [{ role: 'user', content: req.prompt }],
      stream,
      ...(req.thinkingEnabled ? {} : {}),
    };
  }

  private parseOpenAiToolCalls(toolCalls: unknown): ToolCall[] {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls.map((tc: any, i: number) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '{}',
      source: 'response' as const,
    }));
  }
}
