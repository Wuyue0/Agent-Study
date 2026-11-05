import OpenAI from "openai";
import type { LLMProvider } from "./llm.provider.js";
import type { LLMRequest, LLMResponse } from "./llm.types.js";
import type { Logger } from "../observability/logger.js";


// 对openai sdk 进行封装为统一格式
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