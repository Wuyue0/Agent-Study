import type { z } from "zod";

// 工具函数结构定义
export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<T>;
  execute: (args: T) => Promise<unknown>;
}


//请求的结构体 主要是大模型返回的
export interface ToolExecutionRequest {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

// 工具调用的结果结构
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