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

// 大模型请求体
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

// 大模型响应体
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

// 统一请求得个格式体
export interface LLMProvider {
  chat(request: LLMRequest): Promise<LLMResponse>;
}