export interface AgentConfig {
  maxSteps: number;
  systemPrompt: string;
}

export interface AgentResult {
  content: string;
  success: boolean;
  steps: number;
  terminationReason:
    | "completed"
    | "max_steps"
    | "model_length_limit"
    | "provider_error";
}