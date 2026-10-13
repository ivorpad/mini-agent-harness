export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type QueueMode = "one-at-a-time" | "all";
export type ThinkingBudgets = Partial<Record<ThinkingLevel, number>>;
