// core/platform/ai-platform.ts
// AI 平台抽象层：将 DeepSeek Web / DeepSeek API / OpenAI 兼容 API 等不同模型后端
// 统一为一致的接口，使 interceptor/network/chat 等模块不再直接依赖具体平台。

// ==================== 基础类型 ====================

/** 平台标识 */
export const AI_PLATFORMS = {
  DEEPSEEK_WEB: 'deepseek-web',
  DEEPSEEK_API: 'deepseek-api',
  OPENAI_COMPAT: 'openai-compat',
} as const;

export type AiPlatformName = (typeof AI_PLATFORMS)[keyof typeof AI_PLATFORMS];

// ==================== 请求/响应类型 ====================

/** 统一聊天请求 */
export interface ChatRequest {
  sessionId: string;
  parentMessageId: string | number | null;
  modelType: string | null;
  prompt: string;
  refFileIds: string[];
  thinkingEnabled: boolean;
  searchEnabled: boolean;
  /** 平台特定的额外请求头 */
  extraHeaders?: Record<string, string>;
}

/** 工具描述（注入到 LLM 的工具定义） */
export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** 工具调用（LLM 返回的调用指令） */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
  source?: ToolCallSource;
}

export type ToolCallSource = 'stream' | 'response' | 'restore';

// ==================== 流式事件 ====================

/** 统一流式事件 */
export type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; calls: ToolCall[] }
  | { type: 'usage'; tokens: TokenUsage }
  | { type: 'finished'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'metadata'; data: Record<string, unknown> };

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

// ==================== 平台适配器接口 ====================

/**
 * AI 平台适配器
 * 每个平台（DeepSeek Web / DeepSeek API / OpenAI）实现此接口
 */
export interface AiPlatformAdapter {
  /** 平台名称 */
  readonly name: AiPlatformName;

  // ---- 对话 API ----

  /** 发送聊天请求（非流式） */
  sendChat(req: ChatRequest): Promise<ChatResponse>;

  /** 发送聊天请求（流式） */
  streamChat(req: ChatRequest): AsyncIterable<AiStreamEvent>;

  // ---- 工具调用格式 ----

  /** 将工具描述序列化为平台要求的格式 */
  serializeTools(tools: ToolDescriptor[]): unknown;

  /** 从响应中反序列化工具调用 */
  deserializeToolCalls(response: unknown): ToolCall[];

  // ---- 会话管理 ----

  /** 创建新会话 */
  createSession(): Promise<string>;

  /** 获取会话历史 */
  getSessionHistory(sessionId: string): Promise<HistoryMessage[]>;

  // ---- 认证 ----

  /** 获取认证头 */
  getAuthHeaders(): Record<string, string>;

  // ---- 平台能力 ----

  /** 支持的模型列表 */
  readonly supportedModels: string[];

  /** 是否支持思考（reasoning）模式 */
  readonly supportsThinking: boolean;

  /** 是否支持联网搜索 */
  readonly supportsSearch: boolean;

  /** 是否支持文件上传 */
  readonly supportsFileUpload: boolean;
}

// ==================== 辅助类型 ====================

export interface ChatResponse {
  content: string;
  toolCalls: ToolCall[];
  usage?: TokenUsage;
  metadata?: Record<string, unknown>;
}

export interface HistoryMessage {
  id: string | number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  timestamp?: number;
}

// ==================== 工具调用 XML 格式（DeepSeek Web 版本） ====================

/** DeepSeek Web 版使用 XML 格式表达工具调用 */
export const TOOL_XML_TAG = 'tool_call';

export interface XmlToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** 提取 XML 工具标签 */
export function parseXmlToolCalls(text: string): XmlToolCall[] {
  const calls: XmlToolCall[] = [];
  const regex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const nameMatch = block.match(/<tool_name>([\s\S]*?)<\/tool_name>/);
    const argsMatch = block.match(/<arguments>([\s\S]*?)<\/arguments>/);
    if (nameMatch) {
      try {
        calls.push({
          name: nameMatch[1].trim(),
          arguments: argsMatch ? JSON.parse(argsMatch[1].trim()) : {},
        });
      } catch {
        // 解析失败跳过
      }
    }
  }
  return calls;
}

/** DeepSeek Web SSE 事件类型 */
export interface SSEEvent {
  type: string;
  data: string;
  id?: string;
}
