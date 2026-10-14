import { BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core";

export class ToolCallView extends BoxRenderable {
  private readonly heading: TextRenderable;
  private readonly command: TextRenderable;
  private readonly toggle: TextRenderable;
  private readonly output: TextRenderable;
  private outputText = "";
  private expanded = false;

  constructor(context: RenderContext, private readonly toolName: string, details: string) {
    super(context, { width: "100%", paddingX: 2, flexDirection: "column", flexShrink: 0 });
    this.heading = new TextRenderable(context, { content: `${toolName} · preparing`, fg: "#6aa6e8" });
    this.command = new TextRenderable(context, { content: details, fg: "#6aa6e8" });
    this.toggle = new TextRenderable(context, {
      content: "", fg: "#999999", visible: false, selectable: false,
      onMouseUp: event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        this.expanded = !this.expanded;
        this.renderOutput();
      },
    });
    this.output = new TextRenderable(context, { content: "", fg: "#aaaaaa", visible: false });
    this.add(this.heading);
    this.add(this.command);
    this.add(this.toggle);
    this.add(this.output);
  }

  setDetails(details: string): void {
    this.command.content = details;
  }

  setStatus(status: string): void {
    this.heading.content = `${this.toolName} · ${status}`;
  }

  finish(content: string, isError: boolean): void {
    let output = content;
    let exitCode: number | undefined;
    try {
      const result = JSON.parse(content);
      if (typeof result.exitCode === "number") {
        exitCode = result.exitCode;
        isError ||= exitCode !== 0;
        output = [result.stdout, result.stderr].filter(value => typeof value === "string" && value.length).join("\n");
      }
    } catch { /* Display unstructured tool output as received. */ }
    this.setStatus(`${isError ? "failed" : "completed"}${exitCode === undefined ? "" : ` · exit ${exitCode}`}`);
    this.outputText = output;
    this.expanded = false;
    this.renderOutput();
  }

  private renderOutput(): void {
    const lines = this.outputText.split("\n");
    const long = lines.length > 6 || this.outputText.length > 400;
    this.toggle.visible = long;
    this.toggle.content = this.expanded
      ? "▼ Collapse output · click"
      : `▶ Show full output (${lines.length} lines) · click to expand`;
    this.output.visible = this.outputText.length > 0;
    this.output.content = long && !this.expanded
      ? Array.from(lines.slice(0, 3).join("\n")).slice(0, 300).join("") + "\n…"
      : this.outputText;
  }
}
