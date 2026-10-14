import { BoxRenderable, ScrollBoxRenderable, TextareaRenderable, TextRenderable, type RenderContext } from "@opentui/core";
import type { AgentSession } from "../agent/agent-session.ts";

export class ContextPanel extends BoxRenderable {
  private readonly list: ScrollBoxRenderable;
  private readonly summary: TextRenderable;
  private readonly status: TextRenderable;
  private readonly extractButton: TextRenderable;
  private readonly applyButton: TextRenderable;
  private readonly closeButton: TextRenderable;
  private readonly editorBox: BoxRenderable;
  private readonly editor: TextareaRenderable;
  private readonly selected = new Set<number>();
  private readonly drafts = new Map<number, string>();
  private editing?: number;
  private extraction?: AbortController;
  private closing = false;

  constructor(context: RenderContext, private readonly session: AgentSession,
    private readonly changed: () => void, private readonly closed: () => void, private readonly task = "") {
    super(context, { position: "absolute", top: 1, bottom: 1, left: 2, right: 2,
      zIndex: 10, padding: 1, border: true, borderColor: "#6aa6e8", backgroundColor: "#141414", flexDirection: "column", overflow: "hidden" });
    this.add(new TextRenderable(context, { content: "Next request context", fg: "#eeeeee", flexShrink: 0 }));
    this.add(new TextRenderable(context, { content: "Saved history stays intact. Choices last until restored or you exit.", fg: "#999999", flexShrink: 0 }));
    this.summary = new TextRenderable(context, { content: "", fg: "#6aa6e8", flexShrink: 0 });
    this.add(this.summary);
    const actions = new BoxRenderable(context, { flexDirection: "row", flexWrap: "wrap", gap: 2, flexShrink: 0 });
    this.extractButton = this.button("Extract selected", () => { void this.extract(); });
    actions.add(this.extractButton);
    actions.add(this.button("Select all tools", () => {
      if (this.extraction) return;
      session.sessionManager.getMessages().forEach((message, index) => { if (message.role === "tool") this.selected.add(index); });
      this.refresh();
    }));
    actions.add(this.button("Restore all", () => {
      if (this.extraction) return;
      session.context.reset(); this.drafts.clear(); this.changed(); this.refresh();
    }));
    this.add(actions);
    this.status = new TextRenderable(context, { content: "Long outputs are preselected. Extract, review, then apply.", fg: "#999999", flexShrink: 0 });
    this.add(this.status);
    this.list = new ScrollBoxRenderable(context, { flexGrow: 1, flexBasis: 0, minHeight: 0, scrollX: false, contentOptions: { gap: 1 } });
    this.add(this.list);
    this.editorBox = new BoxRenderable(context, { flexGrow: 1, flexBasis: 0, minHeight: 0, flexDirection: "column", visible: false });
    this.editorBox.add(new TextRenderable(context, { content: "Edit the useful context below. Saving creates a draft.", fg: "#999999", flexShrink: 0 }));
    this.editor = new TextareaRenderable(context, { flexGrow: 1, flexBasis: 0, minHeight: 0, backgroundColor: "#222222", textColor: "#eeeeee" });
    this.editorBox.add(this.editor);
    const editorActions = new BoxRenderable(context, { flexDirection: "row", flexWrap: "wrap", gap: 2, flexShrink: 0 });
    editorActions.add(this.button("Save draft", () => {
      if (this.editing === undefined) return;
      if (!this.editor.plainText.trim()) { this.status.content = "Keep some useful text, or use full output."; return; }
      this.drafts.set(this.editing, this.editor.plainText.trim()); this.stopEditing(); this.refresh();
    }));
    editorActions.add(this.button("Cancel edit", () => { this.stopEditing(); }));
    this.editorBox.add(editorActions);
    this.add(this.editorBox);
    const bottom = new BoxRenderable(context, { flexDirection: "row", flexWrap: "wrap", gap: 3, flexShrink: 0 });
    this.applyButton = this.button("Apply drafts", () => {
      if (this.extraction) return;
      const messages = session.sessionManager.getMessages();
      for (const [index, excerpt] of this.drafts) session.context.setToolExcerpt(messages, index, excerpt);
      this.drafts.clear(); this.changed(); this.status.content = "Excerpts applied. Full saved results are unchanged."; this.refresh();
    });
    bottom.add(this.applyButton);
    this.closeButton = this.button("Done · Esc", () => this.close());
    bottom.add(this.closeButton);
    this.add(bottom);
    session.sessionManager.getMessages().forEach((message, index) => {
      if (message.role === "tool" && (message.content.length > 400 || message.content.split("\n").length > 6)) this.selected.add(index);
    });
    this.refresh();
  }

  private button(label: string, clicked: () => void): TextRenderable {
    return new TextRenderable(this.ctx, { content: label, fg: "#6aa6e8", selectable: false, flexShrink: 0,
      onMouseUp: event => { if (event.button === 0) { event.stopPropagation(); event.preventDefault(); clicked(); } } });
  }

  private refresh(): void {
    for (const child of [...this.list.getChildren()]) child.destroyRecursively();
    const messages = this.session.sessionManager.getMessages();
    const projected = this.session.context.project(messages);
    const pending = new Map([...this.drafts].map(([index, text]) => {
      const message = messages[index];
      return [message?.role === "tool" ? message.toolCallId : "", text];
    }));
    const preview = projected.map(message => message.role === "tool" && pending.has(message.toolCallId)
      ? { ...message, content: `[Selected excerpt of saved tool output]\n${pending.get(message.toolCallId)}` } : message);
    this.summary.content = `${projected.length}/${messages.length} messages · Next request: ${JSON.stringify(projected).length.toLocaleString()} chars${this.drafts.size ? ` · Draft preview: ${JSON.stringify(preview).length.toLocaleString()} chars` : ""}`;
    this.extractButton.content = this.extraction ? "Extracting…" : `Extract selected (${this.selected.size})`;
    this.applyButton.content = `Apply all drafts (${this.drafts.size})`;
    this.closeButton.content = this.drafts.size ? "Close · discard drafts" : "Done · Esc";
    for (const [index, message] of messages.entries()) {
      if (message.role === "user") {
        const included = this.session.context.includesUser(index);
        this.list.add(this.button(`#${index} User · ${included ? "Included [click to omit]" : "Omitted [click to restore]"}\n${message.content.slice(0, 140).replaceAll("\n", " ")}`, () => {
          if (this.extraction) return;
          this.session.context.setUserIncluded(messages, index, !included); this.changed(); this.refresh();
        }));
      } else if (message.role === "tool") {
        const draft = this.drafts.get(index);
        const excerpt = this.session.context.toolExcerpt(index);
        const box = new BoxRenderable(this.ctx, { flexDirection: "column", flexShrink: 0 });
        const call = messages.flatMap(message => message.role === "assistant" ? message.toolCalls ?? [] : [])
          .find(call => call.id === message.toolCallId);
        box.add(this.button(`${this.selected.has(index) ? "[x]" : "[ ]"} #${index} ${call?.name ?? "Tool"} · ${draft !== undefined ? "Draft" : excerpt !== undefined ? "Excerpt" : "Full output"} · ${(draft ?? excerpt ?? message.content).length.toLocaleString()}/${message.content.length.toLocaleString()} chars`, () => {
          if (this.extraction) return;
          if (this.selected.has(index)) this.selected.delete(index); else this.selected.add(index);
          this.refresh();
        }));
        box.add(new TextRenderable(this.ctx, { content: (draft ?? excerpt ?? message.content).slice(0, 180).replaceAll("\n", " "), fg: "#aaaaaa", flexShrink: 0 }));
        const actions = new BoxRenderable(this.ctx, { flexDirection: "row", flexWrap: "wrap", gap: 3, flexShrink: 0 });
        actions.add(this.button("Edit excerpt", () => {
          if (this.extraction) return;
          this.editing = index; this.editor.setText(draft ?? excerpt ?? message.content);
          this.list.visible = false; this.editorBox.visible = true; this.editor.focus();
        }));
        actions.add(this.button("Use full output", () => {
          if (this.extraction) return;
          this.drafts.delete(index); this.session.context.setToolExcerpt(messages, index, undefined); this.changed(); this.refresh();
        }));
        box.add(actions); this.list.add(box);
      } else {
        this.list.add(new TextRenderable(this.ctx, { content: `#${index} ${message.role} · ${message.content.slice(0, 100).replaceAll("\n", " ")}${message.role === "assistant" && message.toolCalls?.length ? ` · ${message.toolCalls.length} tool calls` : ""}`, fg: "#777777", flexShrink: 0 }));
      }
    }
  }

  private stopEditing(): void {
    this.editor.blur(); this.editing = undefined; this.editorBox.visible = false; this.list.visible = true;
  }

  private async extract(): Promise<void> {
    if (this.extraction || !this.selected.size) return;
    const controller = this.extraction = new AbortController();
    this.refresh();
    try {
      const excerpts = await this.session.extractToolResults([...this.selected], {
        signal: controller.signal, task: this.task || undefined,
        onProgress: (done, total) => { if (!this.isDestroyed) this.status.content = `Extracting batch ${done}/${total} · ${this.selected.size} tool results · close to cancel`; },
      });
      if (this.isDestroyed) return;
      for (const excerpt of excerpts) this.drafts.set(excerpt.index, excerpt.text);
      this.status.content = `${excerpts.length} drafts ready. Review or edit them, then apply.`;
    } catch (error) {
      if (!this.isDestroyed) this.status.content = `Extraction failed; context unchanged. ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      this.extraction = undefined;
      if (this.closing) this.close();
      else if (!this.isDestroyed) this.refresh();
    }
  }

  close(): void {
    if (this.extraction) {
      this.closing = true; this.extraction.abort(); this.status.content = "Cancelling extraction…"; return;
    }
    this.stopEditing(); this.closed(); this.destroyRecursively();
  }
}
