import type { LLMToolDefinition } from "../llm/llm.types.js";


// 大模型工具格式得定义
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