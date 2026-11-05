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