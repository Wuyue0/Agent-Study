import { z } from "zod";
import type {
  ToolExecutionRequest,
  ToolResult,
} from "./tool.types.js";
import { ToolRegistry } from "./tool.registry.js";
import type { Logger } from "../observability/logger.js";

// 工具的执行器
export class ToolExecutor {
    constructor(
        private readonly registry: ToolRegistry,
        private readonly logger: Logger,
        private readonly defaultTimeoutMs = 10_000,
    ){}

    // 执行工具
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
            this.logger.warn("tool.execution.failed", {...result});
            return result;
        }

        let args: unknown;

        // 主要是工具得校验
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
            this.logger.warn("tool.execution.invalid_arguments", {...result});
            return result;
        }

        // 工具调用 同时 加上超时控制
        try {
            const data = await this.withTimeout(
                () => tool.execute(args),
                this.defaultTimeoutMs,
            );

            const result = finish({ success: true, data });
            this.logger.info("tool.execution.succeeded", {...result});
            return result;
        } catch (error) {
            // 工具调用超时调用失败=
            const timeout =
                error instanceof Error && error.name === "TimeoutError";

            const result = finish({
                success: false,
                error: {
                code: timeout ? "TOOL_TIMEOUT" : "TOOL_EXECUTION_FAILED",
                message: error instanceof Error ? error.message : "Unknown tool error",
                },
            });
            this.logger.error("tool.execution.failed", {...result});
            return result;
        }
    }

    // 执行多个工具
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

    // 超时设置
    private async withTimeout<T>(
        task: () => Promise<T>,
        timeoutMs: number,
    ): Promise<T> {
        let timer: ReturnType<typeof setTimeout> | undefined;

        // 超时设置
        const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
                const error = new Error(`Tool timed out after ${timeoutMs}ms`);
                error.name = "TimeoutError";
                reject(error);
            }, timeoutMs);
        });

        // 如果工具调用 和超时 同时走 谁先到 就采用谁 用于控制函数超时问题
        try {
            return await Promise.race([task(), timeout]);
        } finally {
            if (timer) clearTimeout(timer);
        }
    }

}