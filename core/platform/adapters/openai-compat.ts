// core/platform/adapters/openai-compat.ts
// OpenAI 兼容 API 适配器 — 适用于任何 OpenAI 格式的 API（Claude API via Anthropic、本地 Ollama 等）

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

export const NAME: AiPlatformName = 'openai-compat';

interface OpenAiCompatConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * OpenAI 兼容 API 适配器
 *
 * 兼容任何实现了 OpenAI /v1/chat/completions 格式的 API 服务：
 * - Azure OpenAI
 * - Ollama (本地)
 * - vLLM
 * - Claude API (via Anthropic)
 * - 任何自定义 OpenAI 兼容端点
 */
export class OpenAiCompatAdapter implements AiPlatformAdapter {
  readonly name = NAME;
  readonly supportedModels = []; // 在构造函数中动态设置
  readonly supportsThinking = false;
  readonly supportsSearch = false;
  readonly supportsFileUpload = false;

  private config: OpenAiCompatConfig;

  constructor(config: OpenAiCompatConfig) {
    this.config = config;
    this.supportedModels = [config.model];
  }

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
    return this.parseOpenAiToolCalls(response);
  }

  async createSession(): Promise<string> {
    return `session_${Date.now()}`;
  }

  async getSessionHistory(_sessionId: string): Promise<HistoryMessage[]> {
    return [];
  }

  getAuthHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    };
  }

  private buildRequestBody(req: ChatRequest, stream = false): Record<string, unknown> {
    return {
      model: this.config.model,
      messages: [{ role: 'user', content: req.prompt }],
      stream,
    };
  }

  private parseOpenAiToolCalls(toolCalls: unknown): ToolCall[] {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls.map((tc: any, i: number) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name ?? '',
      arguments: tc.function?.arguments ?? '{}',
      source: 'response' as const,
    }));
  }
}
