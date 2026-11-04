import dotenv from "dotenv";

dotenv.config();

export const config = {
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL,
  model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
};

if (!config.apiKey) {
  throw new Error("DEEPSEEK_API_KEY 未配置，请检查 .env 文件");
}