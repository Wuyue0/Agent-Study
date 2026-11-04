const tools = {
    getWeather: async(city: string) => {
        return {
            city,
            temperature: 22,
            weather: "晴天"
        }
    },
    calculate: async (expression: string) =>{
        const allowed = /^[0-9+\-*/().\s]+$/;
        if(!allowed.test(expression)){
            throw new Error('非法的表达式')
        }
        return {
            expression,
            result: Function(`"use strict"; return (${expression})`)(),
        }
    },
    getCurrentTime: async () =>{
        const now = new Date();
        return {
           date: now.toLocaleDateString("zh-CN", {
                timeZone: "Asia/Shanghai",
            }),

            time: now.toLocaleTimeString("zh-CN", {
                timeZone: "Asia/Shanghai",
                hour12: false,
            }),

            timestamp: now.getTime(),
        }
    }
}

export { tools }