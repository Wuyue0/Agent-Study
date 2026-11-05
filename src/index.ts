import OpenAI from "openai";
import { config } from "./utils/config";
import { Agent } from "./agent/agent";
import { ToolRegistry } from "./tools/tool.registry";
import { ToolExecutor } from "./tools/tool.executor";
import { weatherTool } from "./tools/weather.tool";
import { timeTool } from "./tools/time.tool";
import { calculateTool } from "./tools/calculate.tool";
import { llmTools } from "./tools/tool.schemas";
import { OpenAIProvider } from "./llm/openai.provider";
import { ConsoleLogger } from "./observability/logger";

// 实例化日志对象
const logger = new ConsoleLogger();

// 工具注册器对象
const registry = new ToolRegistry();

// 注册天气对象
registry.register(weatherTool);
// 注册时间
registry.register(timeTool);
// 注册计算
registry.register(calculateTool);

// 工具执行器
const toolExecutor = new ToolExecutor(registry, logger, 10_000);

// 实例化OpenAI sdk
const openai = new OpenAI({
  apiKey: config.apiKey,
  baseURL: config.baseURL,
});

// 使用provider 对于 实例化OpenAI 管理
const provider = new OpenAIProvider(openai, config.model, logger);


// 实例化agent对象
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


async function main() {
 // agent执行起来
  const result = await agent.run(
    "查询北京天气",
  );

  console.log("Agent result:", result);
}

main().catch((error) => {
  console.error("Agent 启动失败:", error);
  process.exitCode = 1;
});