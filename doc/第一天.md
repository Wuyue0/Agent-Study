# Agent 学习笔记 · 第 1 周 第 1 天

日期：2026-11-04　｜　主线：TypeScript + DeepSeek API（OpenAI SDK）

---

## 一、环境与工程

- 用 `.env` 存 API Key，`.gitignore` 里必须写 `.env` 和 `node_modules/`
- Node 不会自动读取 `.env`，在 `package.json` 里这样写，之后用 `npm run dev` 运行：

  ```json
  { "scripts": { "dev": "tsx --env-file=.env index.ts" } }
  ```

- **Key 不能出现在代码、注释、截图里**，泄露了就去控制台删除并重新生成
- 提交 GitHub 前，先用 `git status` 确认 `.env` 没有被带上

## 二、调用模型 API

- DeepSeek 兼容 OpenAI SDK，只需设置 `apiKey` 和 `baseURL`
- JS 区分大小写：`baseURL` 写成 `baseUrl` 会被忽略，请求会发到默认的 OpenAI 地址，导致连接超时
- `thinking` 是 DeepSeek 的扩展参数，OpenAI SDK 的类型里没有，TS 会报红线，但不影响运行。可以用下面的写法绕过类型检查：

  ```ts
  ...({ thinking: { type: "enabled" } } as object),
  ```

- 读 TS 报错只需要找关键一句（如“不在类型中”），其余重载列表可以略过

## 三、messages 结构

| 角色 | 含义 |
|---|---|
| `system` | 全局设定和约束，放最前面，一般一条 |
| `user` | 用户说的话 |
| `assistant` | 模型之前回复过的内容 |

- API 是无状态的，每次请求都要带上完整的对话历史
- 数组按时间顺序排列，最后一条通常是 `user`
- 多轮对话的“记忆”，本质就是自己维护这个数组：每轮追加一条 `user`，拿到回复后再追加一条 `assistant`
- 对话越长，`prompt_tokens` 越多，成本和延迟越高

## 四、请求参数

| 参数 | 作用 |
|---|---|
| `model` | 选用哪个模型 |
| `messages` | 对话内容数组 |
| `stream` | 是否流式输出 |
| `max_tokens` | 本次输出的上限，**带思考的模型里，思考和回答共用这个额度** |
| `thinking` | 思考模式开关（DeepSeek 扩展） |
| `reasoning_effort` | 思考力度，和 `thinking` 配合使用 |

- 不设 `max_tokens` 不等于无限大，会用平台默认值，不同平台行为不同（Anthropic 的接口里它是必填项）

## 五、思考模式

- 思考是中间产物，用户只关心最终回答，但**思考的 token 照样占额度、照样收费**
- 实验数据：
  - `max_tokens: 20`：思考把 20 个 token 全用完，回答为空
  - `max_tokens: 1000`：思考占 567，回答只分到 433，被截断在半句话
- 简单问题开不开思考，答案差不多，开着更慢更贵；复杂推理题才有明显收益
- 用来测试模型的题目不能太出名（如“球拍和球”），模型见过无数遍，测不出差别
- 可以用来测的题：大数乘法、数字母、改了数字的经典题

## 六、usage 字段

| 字段 | 含义 |
|---|---|
| `prompt_tokens` | 输入的 token 数 |
| `completion_tokens` | 输出的 token 数（含思考） |
| `reasoning_tokens` | 输出中的思考部分 |
| `cached_tokens` | 命中缓存的输入，更便宜 |

- 回答被截断时**不会报错**，要检查 `finish_reason`：`length` 表示被截断，`stop` 表示正常结束

## 七、流式输出

- `stream: false`：生成完毕后一次性返回
- `stream: true`：边生成边推送，每个 chunk 是一小段内容
- 总耗时差不多，但流式的**首字出现时间**更短，用户体验更好
- chunk 长度不固定（一个或几个 token），只要按顺序拼接即可
- 判断关键词、解析 JSON 要在拼接后的完整文本上做，不能在单个 chunk 上做
- 最小示例：

  ```ts
  const stream = await openai.chat.completions.create({
    model: "deepseek-flash",
    messages: [{ role: "user", content: "请介绍一下中国的四大发明" }],
    stream: true,
  });

  let full = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    full += delta;
    process.stdout.write(delta); // 不换行，才能连成一段
  }
  ```

- 开思考时，DeepSeek 的思考内容在 `delta.reasoning_content` 里，和 `content` 分开
- 流式默认拿不到 `usage`，需要额外设置 `stream_options`

## 八、踩过的坑

| 现象 | 原因 | 解决 |
|---|---|---|
| `APIConnectionTimeoutError`，地址是 api.openai.com | `baseUrl` 大小写写错 | 改成 `baseURL` |
| `create` 下面有红线 | `thinking` 不在 SDK 类型里 | 用 `as object` 绕过，或加 `@ts-expect-error` |
| 回答为空，只有 usage | `max_tokens` 太小，被思考用完 | 调大，或关闭思考 |
| 回答在半句话处结束 | 被 `max_tokens` 截断 | 检查 `finish_reason`，调大额度 |
| `.gitignore` 没生效 | `node_modules` 拼错 | 改对，并加上 `.env` |

## 待办

- [x] 自己跑一遍流式代码，用 `[ ]` 分隔符看 chunk 粒度
- [x] 打印 `finish_reason`
- [x] 代码提交到 GitHub，确认 `.env` 没被带上
- [x] 确认泄露过的 Key 已重新生成，并更新 `.env`

## 下一步

- `temperature` 参数：对比不同取值的输出差异
- 用 `messages` 数组做一个多轮对话的命令行聊天程序