import { runAgent } from "./agent";

async function main() {
    try{
        const result = await runAgent("请查询北京天气，计算 25 乘以 4，并告诉我现在几点")
        console.log("\nAgent 最终结果：");
        console.log(result);
    }catch(error){
        console.error("agent执行失败", Error)
    }
}

main();