# Day 1 Plus：基础 Agent Runtime 渐进式重构指南

> 目标：在现有 TypeScript + Node.js + OpenAI SDK
> 项目上渐进式重构，不推倒重写。重点是理解每个模块为什么存在，而不是背诵一套固定架构。

## 0. 本次改造范围

完成后包含： - `ToolRegistry`：注册、查询、注销工具。 -
`ToolExecutor`：参数解析、Zod 校验、执行、超时、异常归一化。 -
`LLMProvider`：隔离 OpenAI SDK，给未来接入 Claude 留出适配边界。 -
`Agent`：管理 Agent Loop、上下文、步数和终止原因。 -
`Logger`：记录结构化运行事件。 - 多工具有界并发；部分失败也反馈给模型。

本次暂不实现 RAG、Memory、MCP、多 Agent、持久化
Checkpoint、流式输出和生产级权限系统。

安装 Zod（若尚未安装）：

``` bash
npm install zod
```

## 1. 推荐目录

``` text
src/
├── agent/
│   ├── agent.ts
│   └── agent.types.ts
├── llm/
│   ├── llm.types.ts
│   ├── llm.provider.ts
│   └── openai.provider.ts
├── tools/
│   ├── tool.types.ts
│   ├── tool.registry.ts
│   ├── tool.executor.ts
│   ├── tool.schemas.ts
│   ├── weather.tool.ts
│   ├── time.tool.ts
│   └── calculate.tool.ts
├── observability/
│   └── logger.ts
├── utils/
│   └── config.ts
└── index.ts
```

保留你现有配置文件的位置即可，下面的 import 路径按实际项目调整。

------------------------------------------------------------------------

## 2. 第一步：定义工具契约

新建 `src/tools/tool.types.ts`：

``` typescript
import type { z } from "zod";

export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<T>;
  execute: (args: T) => Promise<unknown>;
}

export interface ToolExecutionRequest {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
  durationMs: number;
}
```

**为什么这样设计？**
工具不只是一个函数。它还需要名称、描述、参数规则和执行逻辑。`ToolDefinition`
是系统内部对工具的完整描述。

Zod Schema 用于系统运行时校验；模型 API 使用的是 JSON
Schema。两者不是同一种对象，后续需要转换或维护对应的模型侧 Schema。

## 3. 第二步：实现 ToolRegistry

新建 `src/tools/tool.registry.ts`：

``` typescript
import type { ToolDefinition } from "./tool.types.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
}
```

**设计边界：** Registry 只管理工具定义，不执行工具、不校验参数。使用
`Map` 表达"名称到工具定义的映射"，而不是把工具理解成队列。

## 4. 第三步：实现结构化 Logger

新建 `src/observability/logger.ts`：

``` typescript
export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

export class ConsoleLogger implements Logger {
  info(event: string, data: Record<string, unknown> = {}): void {
    console.info(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event,
      ...data,
    }));
  }

  warn(event: string, data: Record<string, unknown> = {}): void {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      event,
      ...data,
    }));
  }

  error(event: string, data: Record<string, unknown> = {}): void {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event,
      ...data,
    }));
  }
}
```

Logger 是横向能力。不要记录 API
Key、密码或未经脱敏的敏感参数。生产环境还需要日志访问控制和保留策略。

## 5. 第四步：实现 ToolExecutor

新建 `src/tools/tool.executor.ts`：

``` typescript
import { z } from "zod";
import type {
  ToolExecutionRequest,
  ToolResult,
} from "./tool.types.js";
import { ToolRegistry } from "./tool.registry.js";
import type { Logger } from "../observability/logger.js";

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly logger: Logger,
    private readonly defaultTimeoutMs = 10_000,
  ) {}

  async execute(request: ToolExecutionRequest): Promise<ToolResult> {
    const startedAt = Date.now();

    const finish = (
      result: Omit<ToolResult, "toolCallId" | "toolName" | "durationMs">,
    ): ToolResult => ({
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      durationMs: Date.now() - startedAt,
      ...result,
    });

    const tool = this.registry.get(request.toolName);

    if (!tool) {
      const result = finish({
        success: false,
        error: {
          code: "TOOL_NOT_FOUND",
          message: `Unknown tool: ${request.toolName}`,
        },
      });
      this.logger.warn("tool.execution.failed", result);
      return result;
    }

    let args: unknown;

    try {
      const rawArgs =
        typeof request.args === "string"
          ? JSON.parse(request.args)
          : request.args;

      args = tool.parameters.parse(rawArgs);
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? error.issues
              .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
              .join("; ")
          : error instanceof Error
            ? error.message
            : "Invalid tool arguments";

      const result = finish({
        success: false,
        error: { code: "INVALID_ARGUMENTS", message },
      });
      this.logger.warn("tool.execution.invalid_arguments", result);
      return result;
    }

    try {
      const data = await this.withTimeout(
        () => tool.execute(args),
        this.defaultTimeoutMs,
      );

      const result = finish({ success: true, data });
      this.logger.info("tool.execution.succeeded", result);
      return result;
    } catch (error) {
      const timeout =
        error instanceof Error && error.name === "TimeoutError";

      const result = finish({
        success: false,
        error: {
          code: timeout ? "TOOL_TIMEOUT" : "TOOL_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : "Unknown tool error",
        },
      });
      this.logger.error("tool.execution.failed", result);
      return result;
    }
  }

  async executeMany(
    requests: ToolExecutionRequest[],
    concurrency = 4,
  ): Promise<ToolResult[]> {
    const limit = Math.max(1, Math.floor(concurrency));
    const results = new Array<ToolResult>(requests.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const index = nextIndex++;
        if (index >= requests.length) return;
        results[index] = await this.execute(requests[index]);
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(limit, requests.length) },
        () => worker(),
      ),
    );

    // 返回顺序与请求顺序一致；通过 toolCallId 关联原始调用
    return results;
  }

  private async withTimeout<T>(
    task: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`Tool timed out after ${timeoutMs}ms`);
        error.name = "TimeoutError";
        reject(error);
      }, timeoutMs);
    });

    try {
      return await Promise.race([task(), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
```

**重要边界：** `Promise.race` 超时只代表 Executor
不再等待，不保证底层任务真的停止。真正取消工作需要给工具执行函数传入
`AbortSignal`，并要求底层 API
支持取消。本版本先建立超时边界，后续升级取消机制。

## 6. 第五步：定义统一 LLM 契约

新建 `src/llm/llm.types.ts`：

``` typescript
export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequest {
  messages: LLMMessage[];
  tools: LLMToolDefinition[];
  model?: string;
}

export type LLMFinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "other";

export interface LLMResponse {
  content: string | null;
  toolCalls: LLMToolCall[];
  finishReason: LLMFinishReason;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMProvider {
  chat(request: LLMRequest): Promise<LLMResponse>;
}
```

新建 `src/llm/llm.provider.ts`：

``` typescript
export type { LLMProvider } from "./llm.types.js";
```

**关键理解：** `finishReason` 表示模型本次响应如何结束，不代表 Agent
整个任务已经结束。Agent 自己维护任务终止原因。

## 7. 第六步：实现 OpenAIProvider

新建 `src/llm/openai.provider.ts`：

``` typescript
import OpenAI from "openai";
import type { LLMProvider } from "./llm.provider.js";
import type { LLMRequest, LLMResponse } from "./llm.types.js";
import type { Logger } from "../observability/logger.js";

export class OpenAIProvider implements LLMProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly defaultModel: string,
    private readonly logger: Logger,
  ) {}

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? this.defaultModel;

    const response = await this.client.chat.completions.create({
      model,
      messages: request.messages.map((message) => {
        if (message.role === "tool") {
          if (!message.toolCallId) {
            throw new Error("Tool message requires toolCallId");
          }
          return {
            role: "tool" as const,
            tool_call_id: message.toolCallId,
            content: message.content ?? "",
          };
        }

        if (message.role === "assistant" && message.toolCalls?.length) {
          return {
            role: "assistant" as const,
            content: message.content,
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: {
                name: call.name,
                arguments:
                  typeof call.arguments === "string"
                    ? call.arguments
                    : JSON.stringify(call.arguments),
              },
            })),
          };
        }

        return {
          role: message.role as "system" | "user" | "assistant",
          content: message.content ?? "",
        };
      }),
      tools: request.tools.map((tool) => ({
        type: "function" as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      })),
      tool_choice: request.tools.length ? "auto" : "none",
    });

    const choice = response.choices[0];
    if (!choice) throw new Error("LLM returned no choices");

    const toolCalls = (choice.message.tool_calls ?? [])
      .filter((call) => call.type === "function")
      .map((call) => ({
        id: call.id,
        name: call.function.name,
        // 保留原始 JSON 字符串，交给 Executor 解析并校验
        arguments: call.function.arguments,
      }));

    const finishReason: LLMResponse["finishReason"] =
      choice.finish_reason === "tool_calls"
        ? "tool_calls"
        : choice.finish_reason === "stop"
          ? "stop"
          : choice.finish_reason === "length"
            ? "length"
            : "other";

    const result: LLMResponse = {
      content: choice.message.content,
      toolCalls,
      finishReason,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };

    this.logger.info("llm.response", {
      provider: "openai",
      model,
      finishReason,
      toolCallCount: toolCalls.length,
      usage: result.usage,
    });

    return result;
  }
}
```

> OpenAI SDK 的类型会随版本变化。如果本地 SDK
> 在消息联合类型或工具调用类型上报错，按已安装版本调整 Adapter
> 的类型映射，不要用 `any` 掩盖问题。

## 8. 第七步：定义工具与模型侧 Schema

新建 `src/tools/weather.tool.ts`：

``` typescript
import { z } from "zod";
import type { ToolDefinition } from "./tool.types.js";

const WeatherArgs = z.object({
  city: z.string().min(1),
});

export const weatherTool: ToolDefinition<z.infer<typeof WeatherArgs>> = {
  name: "getWeather",
  description: "查询指定城市的天气",
  parameters: WeatherArgs,
  async execute({ city }) {
    // 暂用模拟数据，之后替换成真实天气服务
    return { city, temperature: 18, condition: "晴" };
  },
};
```

新建 `src/tools/time.tool.ts`：

``` typescript
import { z } from "zod";
import type { ToolDefinition } from "./tool.types.js";

const TimeArgs = z.object({});

export const timeTool: ToolDefinition<z.infer<typeof TimeArgs>> = {
  name: "getCurrentTime",
  description: "获取当前服务器时间",
  parameters: TimeArgs,
  async execute() {
    return { iso: new Date().toISOString() };
  },
};
```

新建 `src/tools/calculate.tool.ts`：

``` typescript
import { z } from "zod";
import type { ToolDefinition } from "./tool.types.js";

const CalculateArgs = z.object({
  a: z.number(),
  b: z.number(),
  operator: z.enum(["add", "subtract", "multiply", "divide"]),
});

export const calculateTool: ToolDefinition<z.infer<typeof CalculateArgs>> = {
  name: "calculate",
  description: "对两个数字进行加减乘除",
  parameters: CalculateArgs,
  async execute({ a, b, operator }) {
    if (operator === "divide" && b === 0) {
      throw new Error("Division by zero");
    }

    switch (operator) {
      case "add": return { result: a + b };
      case "subtract": return { result: a - b };
      case "multiply": return { result: a * b };
      case "divide": return { result: a / b };
    }
  },
};
```

新建 `src/tools/tool.schemas.ts`：

``` typescript
import type { LLMToolDefinition } from "../llm/llm.types.js";

export const llmTools: LLMToolDefinition[] = [
  {
    name: "getWeather",
    description: "查询指定城市的天气",
    parameters: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名称" },
      },
      required: ["city"],
      additionalProperties: false,
    },
  },
  {
    name: "getCurrentTime",
    description: "获取当前服务器时间",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "calculate",
    description: "对两个数字进行加减乘除",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "number" },
        operator: {
          type: "string",
          enum: ["add", "subtract", "multiply", "divide"],
        },
      },
      required: ["a", "b", "operator"],
      additionalProperties: false,
    },
  },
];
```

这里为了清楚展示边界，先把 Zod 运行时 Schema 与模型 JSON Schema
分开维护。后续应建立单一来源或自动生成机制，避免两份规则漂移。

## 9. 第八步：实现 Agent Loop

新建 `src/agent/agent.types.ts`：

``` typescript
export interface AgentConfig {
  maxSteps: number;
  systemPrompt: string;
}

export interface AgentResult {
  content: string;
  success: boolean;
  steps: number;
  terminationReason:
    | "completed"
    | "max_steps"
    | "model_length_limit"
    | "provider_error";
}
```

新建 `src/agent/agent.ts`：

``` typescript
import type { LLMProvider } from "../llm/llm.provider.js";
import type {
  LLMMessage,
  LLMToolDefinition,
} from "../llm/llm.types.js";
import type { ToolExecutor } from "../tools/tool.executor.js";
import type { Logger } from "../observability/logger.js";
import type { AgentConfig, AgentResult } from "./agent.types.js";

export class Agent {
  constructor(
    private readonly provider: LLMProvider,
    private readonly toolExecutor: ToolExecutor,
    private readonly tools: LLMToolDefinition[],
    private readonly logger: Logger,
    private readonly config: AgentConfig,
  ) {}

  async run(input: string): Promise<AgentResult> {
    const runId = crypto.randomUUID();

    const messages: LLMMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      { role: "user", content: input },
    ];

    this.logger.info("agent.run.started", { runId });

    for (let step = 1; step <= this.config.maxSteps; step++) {
      let response;

      try {
        response = await this.provider.chat({
          messages,
          tools: this.tools,
        });
      } catch (error) {
        this.logger.error("agent.provider.failed", {
          runId,
          step,
          error: error instanceof Error ? error.message : "Unknown error",
        });

        return {
          content: "模型服务暂时不可用，请稍后重试。",
          success: false,
          steps: step,
          terminationReason: "provider_error",
        };
      }

      this.logger.info("agent.step.completed", {
        runId,
        step,
        finishReason: response.finishReason,
        toolCallCount: response.toolCalls.length,
        usage: response.usage,
      });

      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.length ? response.toolCalls : undefined,
      });

      if (response.finishReason === "length") {
        return {
          content: response.content ?? "模型输出达到长度限制。",
          success: false,
          steps: step,
          terminationReason: "model_length_limit",
        };
      }

      if (response.toolCalls.length > 0) {
        const results = await this.toolExecutor.executeMany(
          response.toolCalls.map((call) => ({
            toolCallId: call.id,
            toolName: call.name,
            args: call.arguments,
          })),
          4,
        );

        // 成功和失败都反馈给模型，由模型结合上下文决定下一步
        for (const result of results) {
          messages.push({
            role: "tool",
            toolCallId: result.toolCallId,
            content: JSON.stringify(
              result.success
                ? { success: true, data: result.data }
                : { success: false, error: result.error },
            ),
          });
        }

        continue;
      }

      if (response.finishReason === "stop") {
        return {
          content: response.content ?? "",
          success: true,
          steps: step,
          terminationReason: "completed",
        };
      }

      return {
        content: response.content ?? "模型响应未能正常完成。",
        success: false,
        steps: step,
        terminationReason: "provider_error",
      };
    }

    this.logger.warn("agent.run.max_steps", {
      runId,
      maxSteps: this.config.maxSteps,
    });

    return {
      content: "已达到最大执行步数，任务停止。",
      success: false,
      steps: this.config.maxSteps,
      terminationReason: "max_steps",
    };
  }
}
```

### Agent 设计的关键边界

-   Agent 依赖 `LLMProvider`，不依赖 OpenAI SDK。
-   Agent 依赖 `ToolExecutor`，不直接调用 `getWeather()`。
-   Agent 不直接操作 Registry。
-   工具部分失败不会自动终止整个 Agent；失败结果回到模型上下文。
-   Runtime
    仍然负责最大步数、超时和权限等硬性约束，不能把安全边界交给模型。

## 10. 第九步：组装依赖并运行

按你项目的 config 导出形式调整下面入口。假设 `config` 有
`apiKey`、`baseURL`、`model`：

``` typescript
import OpenAI from "openai";

import { config } from "./utils/config.js";
import { Agent } from "./agent/agent.js";
import { ToolRegistry } from "./tools/tool.registry.js";
import { ToolExecutor } from "./tools/tool.executor.js";
import { weatherTool } from "./tools/weather.tool.js";
import { timeTool } from "./tools/time.tool.js";
import { calculateTool } from "./tools/calculate.tool.js";
import { llmTools } from "./tools/tool.schemas.js";
import { OpenAIProvider } from "./llm/openai.provider.js";
import { ConsoleLogger } from "./observability/logger.js";

const logger = new ConsoleLogger();

const registry = new ToolRegistry();
registry.register(weatherTool);
registry.register(timeTool);
registry.register(calculateTool);

const toolExecutor = new ToolExecutor(registry, logger, 10_000);

const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
});

const provider = new OpenAIProvider(openai, config.model, logger);

const agent = new Agent(
  provider,
  toolExecutor,
  llmTools,
  logger,
  {
    maxSteps: 5,
    systemPrompt:
      "你是一个有帮助的助手。你可以查询天气、获取当前时间和进行基础计算。需要实时信息时使用工具，不要编造工具结果。",
  },
);

const result = await agent.run(
  "查询北京天气，并告诉我现在的时间。",
);

console.log("Agent result:", result);
```

如果项目采用 CommonJS，或没有启用 ESM，请按当前 TypeScript 配置调整
import 扩展名和启动方式。不要为了照抄示例而切换整个项目的模块系统。

------------------------------------------------------------------------

## 11. 第十步：验收测试清单

### 基础闭环

-   [X] 纯文本问题：模型不调用工具，直接回答。
-   [X] 单工具问题：调用工具、执行、结果回传、生成最终回答。
-   [X] 多工具问题：一次响应包含多个工具调用。
-   [X] 连续调用：模型收到第一轮工具结果后，再请求下一轮工具。

### 工具治理

-   [X] 注册同名工具：明确报错，不静默覆盖。
-   [X] 查询不存在的工具：返回 `TOOL_NOT_FOUND`。
-   [X] 参数缺失或类型错误：返回 `INVALID_ARGUMENTS`，工具不得执行。
-   [X] 工具抛异常：返回 `TOOL_EXECUTION_FAILED`。
-   [X] 工具超时：返回 `TOOL_TIMEOUT`。
-   [X] 多工具部分失败：成功和失败结果都反馈给模型。

### Agent 边界

-   [X] 连续请求工具达到 `maxSteps` 后停止。
-   [X] 模型返回长度限制时，不能误判为成功。
-   [X] Provider 异常时返回可识别的失败结果。
-   [X] 每个工具结果的 `toolCallId` 与原始调用 ID 一致。
-   [X] 并发执行后，结果仍能与各自调用对应。

### 可观测性

-   [X] 日志包含 `runId`、`step`、事件名称。
-   [X] 工具日志包含工具名、耗时、成功/失败状态。
-   [X] 模型日志包含 finishReason 和 Token usage（如果 Provider 提供）。
-   [X] 日志没有 API Key 或其他敏感信息。

------------------------------------------------------------------------

## 12. 本版本的已知限制与后续演进

这是一版用于学习和验证架构边界的基础
Runtime，不是生产就绪的企业框架。后续逐步补充：

1.  **工具取消机制**：使用 `AbortSignal` 取消底层请求。
2.  **工具依赖声明**：不是所有工具调用都可以并行，需要识别依赖或分阶段执行。
3.  **Schema 单一来源**：从统一工具定义生成模型 JSON
    Schema，避免规则漂移。
4.  **Provider
    错误分类**：区分限流、认证、网络、上下文超限和服务端错误。
5.  **重试策略**：有界重试，并考虑工具幂等性。
6.  **Token 与成本治理**：记录模型、Token、耗时和成本估算。
7.  **上下文管理**：限制历史长度，后续引入 Context Manager。
8.  **持久化与恢复**：保存运行状态和 Checkpoint。
9.  **工具权限**：按用户、租户、Agent 和工具授权。
10. **测试体系**：为 Registry、Executor、Provider Adapter、Agent Loop
    分别建立单元测试和集成测试。

## 13. 推荐替换顺序

不要一次性替换所有文件。每一步完成后都运行测试：

  顺序   操作                       验收标准
  ------ -------------------------- -----------------------------
  1      新增工具类型和 Registry    注册、查询、注销正常
  2      新增 Logger                能输出结构化事件
  3      新增 ToolExecutor          校验、异常、超时正常
  4      定义 LLM 契约和 Provider   OpenAI 请求/响应适配正常
  5      改造 Agent                 只依赖 Provider 和 Executor
  6      改造入口文件               依赖组装后能运行
  7      执行验收清单               基础和异常场景通过

## 完成标准

当你能够解释每个模块为什么存在、说明依赖方向、验证未通过参数校验的工具不会执行、证明部分失败不会丢失其他工具结果，并通过测试验证
Agent 的终止边界，就算完成 Day 1 Plus。

**架构不是为了多拆几个文件。每个模块都应该对应真实的职责边界或变化点。**
