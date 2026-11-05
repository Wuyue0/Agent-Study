export interface Logger {
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}


export class ConsoleLogger implements Logger {
  info(event: string, data: Record<string, unknown> = {}): void {
    console.info(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      event,
      ...data,
    }));
  }

  warn(event: string, data: Record<string, unknown> = {}): void {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "warn",
      event,
      ...data,
    }));
  }

  error(event: string, data: Record<string, unknown> = {}): void {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "error",
      event,
      ...data,
    }));
  }
}