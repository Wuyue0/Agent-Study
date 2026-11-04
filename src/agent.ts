import OpenAI from "openai";
import { tools } from "./tools";
import { config } from "../utils/config"
import { z } from "zod";

const WeatherSchema = z.object({
    city: z.string().min(1)
});

const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL
});


export async function runAgent(userInput: string) {

    // 消息列表
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
            role: "system",
            content: `
                你是一个智能助手。

                你可以使用以下工具：
                1. getWeather：查询城市天气。
                2. calculate：执行数学计算。
                3. getCurrentTime：获取当前时间。

                请根据用户需求选择合适的工具。
                如果需要多个工具，可以连续调用多个工具。
                获取工具执行结果后，再组织最终回答。

                如果任务已经完成，请直接给出答案。
            `
        },
        {
            role: "user",
            content: userInput
        }
    ]

    // 开始循环调度跟大模型交互
    for(let step = 0; step < 5; step++){
        console.log(`Agent 正在执行第 ${step + 1} 步`);
        const response = await client.chat.completions.create({
             model: config.model,
             messages,
             tools: [
                {
                    type: "function",
                    function: {
                        name: 'getWeather',
                        description: '查询城市天气',
                        parameters: {
                            type: "object",
                            properties: {
                                city: { type: "string"}
                            },
                            required: ["city"],
                            additionalProperties: false
                        },
                        strict: true
                    }
                },
                {
                    type: "function",
                    function: {
                        name: "calculate",
                        description: "执行数学计算",
                        parameters: {
                            type: "object",
                            properties: {
                                expression: { type: "string" },
                            },
                            required: ["expression"],
                            additionalProperties: false,
                        },
                        strict: true,
                    },
                },
                {
                    type: "function",
                    function: {
                        name: "getCurrentTime",
                        description: "获取当前时间",
                        parameters: {
                            type: "object",
                            properties: {},
                            required: [],
                            additionalProperties: false,
                        },
                        strict: true,
                    }
                }
             ]
        })
        const message = response.choices[0].message;
        messages.push(message)

        // 模型没有调用工具，说明可以结束本轮任务 这里最重要了 因为这个标志代表任务结束
        if(!message.tool_calls?.length){
            return message.content
        }

        for(const toolCall of message.tool_calls){
            // 只处理 function 类型的工具调用
            if (toolCall.type !== "function") {
                throw new Error("暂不支持非 function 类型的工具调用");
            }

            const args = WeatherSchema.parse(JSON.parse(toolCall.function.arguments));

            let result: unknown;

            switch(toolCall.function.name){
                case "getWeather": 
                    result = await tools.getWeather(args.city);
                    break;
                case "calculate": 
                    result = await tools.calculate(args.expression);
                    break;
                case "getCurrentTime":
                    result = await tools.getCurrentTime();
                    break;
                default:
                    throw new Error( `Unknown tool: ${toolCall.function.name}`)
            }

            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify(result)
            })
        }
    }

    throw new Error("Agent 超过最大执行步数");
}