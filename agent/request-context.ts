import type { Message } from "./messages.ts";

export class RequestContext {
  private readonly omittedUsers = new Set<number>();
  private readonly excerpts = new Map<number, string>();

  includesUser(index: number): boolean { return !this.omittedUsers.has(index); }
  toolExcerpt(index: number): string | undefined { return this.excerpts.get(index); }

  setUserIncluded(messages: Message[], index: number, included: boolean): void {
    if (messages[index]?.role !== "user") throw new Error("Select a user message");
    if (included) this.omittedUsers.delete(index);
    else this.omittedUsers.add(index);
  }

  setToolExcerpt(messages: Message[], index: number, excerpt: string | undefined): void {
    if (messages[index]?.role !== "tool") throw new Error("Select a tool result");
    if (excerpt === undefined) this.excerpts.delete(index);
    else {
      if (!excerpt.trim()) throw new Error("An excerpt must contain text");
      this.excerpts.set(index, excerpt);
    }
  }

  reset(): void {
    this.omittedUsers.clear();
    this.excerpts.clear();
  }

  project(messages: Message[]): Message[] {
    return structuredClone(messages.flatMap((message, index): Message[] => {
      if (message.role === "user" && !this.includesUser(index)) return [];
      const excerpt = this.excerpts.get(index);
      if (message.role === "tool" && excerpt !== undefined) {
        return [{ ...message, content: `[Selected excerpt of saved tool output]\n${excerpt}` }];
      }
      return [message];
    }));
  }
}
