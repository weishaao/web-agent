// core/platform/adapters/deepseek-web.ts
// DeepSeek Web 平台适配器 — 通过拦截 chat.deepseek.com 网页版 API 工作
// 封装了 original interceptor + network + deepseek 模块的核心逻辑

import type {
  AiPlatformAdapter,
  AiPlatformName,
  ChatRequest,
  ChatResponse,
  ToolDescriptor,
  ToolCall,
  AiStreamEvent,
  TokenUsage,
  HistoryMessage,
} from '../ai-platform';

import {
  DEEPSEEK_WEB_ORIGIN,
  DEEPSEEK_WEB_ROUTES,
  DEEPSEEK_BYPASS_HOOK_HEADER,
} from '../../deepseek/contracts';

import {
  encodeCompletionRequest,
  encodeCreateSessionRequest,
  encodeHistoryRequest,
  normalizeDeepSeekModelType,
  normalizeDeepSeekMessageId,
} from '../../deepseek/request-codec';

import {
  createDeepSeekSseFrameDecoder,
  createDeepSeekStreamSummary,
  consumeDeepSeekSseFrames,
  extractResponseTextFromParsed,
  type DeepSeekSseFrame,
} from '../../deepseek/stream-codec';

export const NAME: AiPlatformName = 'deepseek-web';

/**
 * DeepSeek Web 平台适配器
 *
 * 工作方式：
 * 1. 拦截 chat.deepseek.com 的私有 API 请求/响应
 * 2. 在请求中注入工具描述（注入 system prompt）
 * 3. 拦截响应中的 XML 工具调用标签
 */
export class DeepSeekWebAdapter implements AiPlatformAdapter {
  readonly name = NAME;
  readonly supportedModels = ['default', 'expert', 'vision'];
  readonly supportsThinking = true;
  readonly supportsSearch = true;
  readonly supportsFileUpload = true;

  // 内部状态
  private hookInstalled = false;
  private toolDescriptors: ToolDescriptor[] = [];

  /** 配置可用工具 */
  setTools(tools: ToolDescriptor[]): void {
    this.toolDescriptors = tools;
  }

  // ==================== 对话 API ====================

  async sendChat(req: ChatRequest): Promise<ChatResponse> {
    const encoded = encodeCompletionRequest({
      chatSessionId: req.sessionId,
      parentMessageId: typeof req.parentMessageId === 'number' ? req.parentMessageId : null,
      modelType: req.modelType ?? null,
      prompt: req.prompt,
      refFileIds: req.refFileIds,
      thinkingEnabled: req.thinkingEnabled,
      searchEnabled: req.searchEnabled,
      clientHeaders: req.extraHeaders ?? {},
      powHeaders: {},
    });

    const response = await fetch(encoded.url, encoded.init);
    const text = await response.text();

    // 解析 SSE 响应获取完整文本
    const events = this.parseSSEResponse(text);
    const content = events.filter(e => e.type === 'text').map(e => e.text).join('');
    const toolCalls = events.flatMap(e => e.type === 'tool_call' ? (e as any).calls : []);

    return { content, toolCalls };
  }

  async *streamChat(req: ChatRequest): AsyncIterable<AiStreamEvent> {
    const encoded = encodeCompletionRequest({
      chatSessionId: req.sessionId,
      parentMessageId: typeof req.parentMessageId === 'number' ? req.parentMessageId : null,
      modelType: req.modelType ?? null,
      prompt: req.prompt,
      refFileIds: req.refFileIds,
      thinkingEnabled: req.thinkingEnabled,
      searchEnabled: req.searchEnabled,
      clientHeaders: req.extraHeaders ?? {},
      powHeaders: {},
    });

    const response = await fetch(encoded.url, {
      ...encoded.init,
      // 确保流式读取
    });

    if (!response.body) {
      yield { type: 'error', message: 'Response body is null' };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const summary = createDeepSeekStreamSummary();
    const frameDecoder = createDeepSeekSseFrameDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        const frames = frameDecoder.push(text);

        for (const frame of frames) {
          if (!frame.event || !frame.parsed) continue;

          // 产出文本
          const responseText = extractResponseTextFromParsed(frame.parsed);
          if (responseText) {
            yield { type: 'text', text: responseText };
          }

          // 检查思考内容
          const thinkingText = this.extractThinkingText(frame);
          if (thinkingText) {
            yield { type: 'reasoning', text: thinkingText };
          }

          // 检查完成状态
          if (this.isFinished(frame.parsed)) {
            yield { type: 'finished', reason: 'stop' };
          }
        }
      }

      // 处理剩余帧
      const finalFrames = frameDecoder.finish();
      for (const frame of finalFrames) {
        if (!frame.event || !frame.parsed) continue;
        const responseText = extractResponseTextFromParsed(frame.parsed);
        if (responseText) {
          yield { type: 'text', text: responseText };
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ==================== 工具调用格式 ====================

  serializeTools(tools: ToolDescriptor[]): unknown {
    // DeepSeek Web 使用 XML 格式注入工具描述到 system prompt
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
    // DeepSeek Web 在流式输出中使用 XML <tool_call> 标签
    // 实际解析在 stream 中完成，此方法用于非流式回退
    if (typeof response !== 'string') return [];
    return this.parseXmlToolCalls(response);
  }

  // ==================== 会话管理 ====================

  async createSession(): Promise<string> {
    const encoded = encodeCreateSessionRequest({});
    const response = await fetch(encoded.url, encoded.init);
    const data = await response.json();
    return data?.data?.id ?? data?.id ?? '';
  }

  async getSessionHistory(sessionId: string): Promise<HistoryMessage[]> {
    const encoded = encodeHistoryRequest(sessionId, {});
    const response = await fetch(encoded.url, encoded.init);
    const data = await response.json();
    // 转换 DeepSeek 历史格式为统一格式
    return this.normalizeHistory(data);
  }

  // ==================== 认证 ====================

  getAuthHeaders(): Record<string, string> {
    // DeepSeek Web 使用 cookie/会话认证，通过 fetch credentials: 'include' 处理
    return {};
  }

  // ==================== 内部方法 ====================

  private parseSSEResponse(text: string): AiStreamEvent[] {
    const events: AiStreamEvent[] = [];
    const lines = text.split('\n');
    let currentText = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        try {
          const parsed = JSON.parse(data);
          const responseText = extractResponseTextFromParsed(parsed);
          if (responseText) {
            currentText += responseText;
          }
          if (this.isFinished(parsed)) {
            if (currentText) {
              events.push({ type: 'text', text: currentText });
              currentText = '';
            }
            events.push({ type: 'finished', reason: 'stop' });
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    if (currentText) {
      events.push({ type: 'text', text: currentText });
    }

    return events;
  }

  private extractThinkingText(frame: DeepSeekSseFrame): string | null {
    const parsed = frame.parsed as Record<string, unknown> | null;
    if (!parsed) return null;
    const path = parsed.p;
    if (typeof path !== 'string') return null;
    const lastSegment = path.split('/').pop();
    if ((lastSegment === 'reasoning_content' || lastSegment === 'thinking_content') && typeof parsed.v === 'string') {
      return parsed.v;
    }
    return null;
  }

  private isFinished(parsed: unknown): boolean {
    const value = parsed as Record<string, unknown> | null;
    if (!value) return false;
    if (value.p === 'response/status' && value.v === 'FINISHED') return true;
    if (value.o === 'BATCH' && Array.isArray(value.v)) {
      return value.v.some(
        (item: Record<string, unknown>) => item.p === 'quasi_status' && item.v === 'FINISHED',
      );
    }
    return false;
  }

  private parseXmlToolCalls(text: string): ToolCall[] {
    const calls: ToolCall[] = [];
    const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      const block = match[1].trim();
      const nameMatch = block.match(/<tool_name>([\s\S]*?)<\/tool_name>/);
      const argsMatch = block.match(/<arguments>([\s\S]*?)<\/arguments>/);
      if (nameMatch) {
        calls.push({
          id: `call_${calls.length}`,
          name: nameMatch[1].trim(),
          arguments: argsMatch ? argsMatch[1].trim() : '{}',
          source: 'response',
        });
      }
    }
    return calls;
  }

  private normalizeHistory(data: unknown): HistoryMessage[] {
    // DeepSeek web 历史格式转换
    try {
      const messages = (data as any)?.data?.messages ?? (data as any)?.messages ?? [];
      return messages.map((msg: any) => ({
        id: msg.id ?? msg.message_id ?? '',
        role: msg.role ?? 'user',
        content: msg.content ?? msg.text ?? '',
        timestamp: msg.created_at ?? msg.timestamp,
      }));
    } catch {
      return [];
    }
  }
}
