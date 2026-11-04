
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

async function main(){
    const stream = await openai.chat.completions.create({
       messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "7919 × 6271 等于多少？"}
       ],
       model: "deepseek-flash",
       ...({ thinking: { type: "disabled" } } as object),
      //  reasoning_effort: "high",
       stream: true,
       max_tokens: 20,
    })
    let full = ""
    let finishReason = null;
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if(choice?.delta?.content) {
         full += choice.delta.content;
         process.stdout.write(choice.delta.content);
      }

      if(choice.finish_reason){
        finishReason = choice.finish_reason;
      }
    }
    console.log('\nfinish_reason:', finishReason);
    // console.log(completion.choices[0].message.content);
    // console.log('token用量', completion.usage);

}


main();