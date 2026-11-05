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