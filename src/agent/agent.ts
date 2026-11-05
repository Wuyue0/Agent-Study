import type { LLMProvider } from "../llm/llm.provider.js";
import type {
  LLMMessage,
  LLMToolDefinition,
} from "../llm/llm.types.js";
import type { ToolExecutor } from "../tools/tool.executor";
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
    const runId = crypto.randomUUID(); //直接使用就可以 属于node本身得模块

    const messages: LLMMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      { role: "user", content: input },
    ];

    this.logger.info("agent.run.started", { runId });
    // agent loop
    for (let step = 1; step <= this.config.maxSteps; step++) {
      let response;

      // 1.模型调用以及错误处理
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

      // 2.模型得输出进行log显示 用于跟踪排查异常
      this.logger.info("agent.step.completed", {
        runId,
        step,
        finishReason: response.finishReason,
        toolCallCount: response.toolCalls.length,
        usage: response.usage,
      });

      // 3. 将模型得相应添加到数组中
      messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls.length ? response.toolCalls : undefined,
      });

      // 模型输出达到长度限制。
      if (response.finishReason === "length") {
        return {
          content: response.content ?? "模型输出达到长度限制。",
          success: false,
          steps: step,
          terminationReason: "model_length_limit",
        };
      }

      // 工具调用
      if (response.toolCalls.length > 0) {
        const results = await this.toolExecutor.executeMany(
          response.toolCalls.map((call) => ({
            toolCallId: call.id,
            toolName: call.name,
            args: call.arguments, // 故意模拟错误参数
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

      // 模型最终得输出
      if (response.finishReason === "stop") {
        return {
          content: response.content ?? "",
          success: true,
          steps: step,
          terminationReason: "completed",
        };
      }

      // 异常处理 跳出了 我们得逻辑判断 非常规情况
      return {
        content: response.content ?? "模型响应未能正常完成。",
        success: false,
        steps: step,
        terminationReason: "provider_error",
      };
    }

    // 模型循环次数超长处理 不能无限循环 日志打印
    this.logger.warn("agent.run.max_steps", {
      runId,
      maxSteps: this.config.maxSteps,
    });

    // 返回错误得一些信息 
    return {
      content: "已达到最大执行步数，任务停止。",
      success: false,
      steps: this.config.maxSteps,
      terminationReason: "max_steps",
    };
  }
}