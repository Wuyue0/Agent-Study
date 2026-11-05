import { ToolDefinition } from "./tool.types";


export class ToolRegistry {

    // 声明map结构 存储工具名 以及对应的执行流程
    private readonly tools = new Map<string, ToolDefinition<any>>();

    // 工具注册
    register<T>(tool: ToolDefinition<T>):void{
        if(this.tools.has(tool.name)){
            throw new Error(`Tool already registered: ${tool.name}`);
        }
        this.tools.set(tool.name, tool);
    }

    //获取工具 指定名字的工具
    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    // 获取所有的工具
    getAll(): ToolDefinition[] {
        return [...this.tools.values()];
    }

    // 取消注册工具
    unregister(name: string):boolean{
        return this.tools.delete(name);
    }

}
