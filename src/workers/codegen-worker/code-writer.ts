import type { CodeDiagnostic, CodeSourceMapSpan, EmittedCodeFile, NodeId } from '@shared/ui-ir';

export class SourceMapWriter {
  private lines: string[] = [];
  private indentLevel = 0;
  private readonly indentUnit: string;
  private readonly openSpans = new Map<NodeId, { startLine: number; startCol: number }>();
  private readonly completedSpans: CodeSourceMapSpan[] = [];
  private readonly diagnostics: CodeDiagnostic[] = [];

  constructor(indentSpaces = 2) {
    this.indentUnit = ' '.repeat(indentSpaces);
  }

  get currentLineNumber(): number {
    return this.lines.length + 1;
  }

  get currentIndentCols(): number {
    return this.indentLevel * this.indentUnit.length + 1;
  }

  indent(): void {
    this.indentLevel++;
  }

  dedent(): void {
    this.indentLevel = Math.max(0, this.indentLevel - 1);
  }

  line(text = ''): void {
    if (text.length === 0) {
      this.lines.push('');
      return;
    }
    const prefix = this.indentUnit.repeat(this.indentLevel);
    const subLines = text.split('\n');
    for (const sub of subLines) {
      this.lines.push(sub.length > 0 ? `${prefix}${sub}` : '');
    }
  }

  rawBlock(text: string): void {
    const subLines = text.split('\n');
    for (const sub of subLines) {
      this.lines.push(sub);
    }
  }

  blank(): void {
    if (this.lines.length > 0 && this.lines[this.lines.length - 1] !== '') {
      this.lines.push('');
    }
  }

  openNode(canvasNodeId: NodeId): void {
    this.openSpans.set(canvasNodeId, {
      startLine: this.currentLineNumber,
      startCol: this.currentIndentCols,
    });
  }

  closeNode(canvasNodeId: NodeId): void {
    const start = this.openSpans.get(canvasNodeId);
    if (!start) return;
    this.openSpans.delete(canvasNodeId);
    const endLine = Math.max(start.startLine, this.lines.length);
    const endLineText = this.lines[endLine - 1] ?? '';
    this.completedSpans.push({
      canvasNodeId,
      startLine: start.startLine,
      startCol: start.startCol,
      endLine,
      endCol: Math.max(1, endLineText.length + 1),
    });
  }

  withNode(canvasNodeId: NodeId, fn: () => void): void {
    this.openNode(canvasNodeId);
    try {
      fn();
    } finally {
      this.closeNode(canvasNodeId);
    }
  }

  addDiagnostic(severity: CodeDiagnostic['severity'], message: string, canvasNodeId?: NodeId): void {
    this.diagnostics.push({ severity, message, canvasNodeId });
  }

  toCode(): string {
    return this.lines.join('\n').trimEnd() + '\n';
  }

  toEmittedFile(relativePath: string, language: string, isEntry = false): EmittedCodeFile {
    return {
      relativePath,
      language,
      code: this.toCode(),
      isEntry,
      sourceMap: [...this.completedSpans],
      diagnostics: [...this.diagnostics],
    };
  }
}
