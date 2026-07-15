# web-agent 项目 — Fork 与 Platform Interface 改造

> 基于 DeepSeek++ (zhu1090093659/deepseek-pp) 的私有 fork
> 项目名称：web-agent（Chrome Web Store 合规，不含"DeepSeek"）
> 仓库：https://github.com/weishaao/web-agent

## 当前状态 (2026-07-15)

### ✅ 已完成

| 阶段 | 状态 | 说明 |
|------|------|------|
| Fork 仓库 | ✅ | weishaao/web-agent (Public，可改私有) |
| 本地 clone | ✅ | /home/nate/projects/web-agent |
| npm install | ✅ | 依赖安装完成（8 个漏洞，上游遗留） |
| npm run build:chrome | ✅ | 12.8s 构建通过，18.51MB 输出 |
| Platform Interface 框架 | ✅ | 4 个新文件，988 行新增，编译通过 |
| 推送分支 | ✅ | feature/platform-interface 已推送 |

### 🚧 进行中

Platform Interface Phase 1 完成，进入 Phase 2（迁移现有消费者）

### Phase 0: Fork & Run ⏭️ DONE

### Phase 1: Core Risk Fixes ⏸️ 暂缓（平台接口先行）

### Phase 2: Platform Interface — Phase 1 ✅ DONE

创建了 Platform Interface 架构，共 4 个文件、988 行代码：

#### 核心架构

```
core/platform/
├── ai-platform.ts       # 统一类型定义 (AiPlatformAdapter, ChatRequest, AiStreamEvent 等)
├── ai-router.ts         # 平台路由器 (registerPlatform, setActivePlatform, getActivePlatform)
├── index.ts             # 统一导出
└── adapters/
    ├── deepseek-web.ts   # Adapter 1: DeepSeek Web（拦截 chat.deepseek.com）
    ├── deepseek-api.ts   # Adapter 2: DeepSeek 官方 API（api.deepseek.com）
    └── openai-compat.ts  # Adapter 3: OpenAI 兼容端（Ollama, vLLM, Claude via API 等）
```

#### AiPlatformAdapter 接口

```typescript
interface AiPlatformAdapter {
  name: 'deepseek-web' | 'deepseek-api' | 'openai-compat';
  supportedModels: string[];
  supportsThinking: boolean;
  supportsSearch: boolean;
  supportsFileUpload: boolean;

  // 核心 API
  sendChat(req: ChatRequest): Promise<ChatResponse>;
  streamChat(req: ChatRequest): AsyncIterable<AiStreamEvent>;

  // 工具
  serializeTools(tools: ToolDescriptor[]): unknown;
  deserializeToolCalls(response: unknown): ToolCall[];

  // 会话
  createSession(): Promise<string>;
  getSessionHistory(sessionId: string): Promise<HistoryMessage[]>;

  // 认证
  getAuthHeaders(): Record<string, string>;
}
```

#### AiStreamEvent 统一流式事件

```typescript
type AiStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; calls: ToolCall[] }
  | { type: 'usage'; tokens: TokenUsage }
  | { type: 'finished'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'metadata'; data: Record<string, unknown> };
```

---

## Phase 2 迁移计划（当前）

将现有消费者从直接 import `core/deepseek/*` 迁移到通过 Platform Router 访问：

### 迁移清单

| 编号 | 模块 | 当前耦合点 | 迁移方案 | 复杂度 |
|------|------|-----------|----------|--------|
| M1 | `core/interceptor/fetch-hook.ts` | 直接 import `deepseek/request-codec`, `deepseek/stream-codec` | 改为通过 `getActivePlatform()` 调用 | 🔴 高 (1442 行) |
| M2 | `core/chat/active-loop.ts` | 直接调用 DeepSeek Web API | 通过 platform API | 🟡 中 |
| M3 | `core/chat/store.ts` | 依赖 DeepSeek 会话 ID 格式 | 抽象会话 ID | 🟢 低 |
| M4 | `core/deepseek/pow.ts` | PoW 挑战（仅 DeepSeek Web 需要） | 迁移到 deepseek-web adapter | 🟢 低 |
| M5 | `core/deepseek/automation-client-port.ts` | 自动化客户端 | 通过 platform API | 🟡 中 |

### 迁移原则

1. **不改已有功能** — 所有现有 deepseek-web 行为保持完全不变
2. **渐进式** — 一次迁移一个消费者，每次提交后构建验证
3. **不删旧代码** — `core/deepseek/*` 保留直到所有消费者迁移完毕
4. **测试先行** — 重要模块引用前先加测试

---

## 三大适配器对比

| 特性 | DeepSeek Web | DeepSeek API | OpenAI Compat |
|------|-------------|-------------|---------------|
| 认证方式 | Cookie/Session | API Key | API Key |
| 联网搜索 | ✅ | ❌ | ❌ |
| 思考模式 | ✅ | ✅ | ❌ |
| 文件上传 | ✅ | ❌ | ❌ |
| 工具调用格式 | XML in prompt | OpenAI function_call | OpenAI function_call |
| 流式格式 | DeepSeek SSE (patch-based) | OpenAI SSE | OpenAI SSE |
| 会话管理 | 云端 | 无状态 | 无状态 |
| 适用场景 | 网页版 DeepSeek | 官方 API | Ollama/vLLM/Claude API |

---

## 风险与注意事项

1. **PoW 挑战** — DeepSeek Web 有 Proof-of-Work 验证，已封装在 deepseek-web adapter 中
2. **fetch-hook.ts 重构风险** — 最复杂的模块（1442 行），建议分步迁移
3. **Host permissions** — deepseek-web adapter 需要 `chat.deepseek.com` 权限；deepseek-api 需要 `api.deepseek.com`；openai-compat 需要自定义域名
4. **Pyodide 沙箱** — 当前构建包含 15MB+ Pyodide WASM，openai-compat 模式下可裁剪
