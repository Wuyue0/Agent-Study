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