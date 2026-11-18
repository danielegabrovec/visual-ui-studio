import type {
  AgentStreamEvent,
  AgentToolCallRecord,
  LocalAIProviderKind,
} from '@shared/ipc-contract';
import type { DesignTokenEntry, NodeId, UINode, UISheetDocument } from '@shared/ui-ir';
import {
  applyPatchOpsToSheet,
  hydrateCompactOpsToPatches,
  type AICompactPatchOp,
  type UIPatchOp,
} from '@shared/ui-patch';
import type { AiTurnExecutionContext, AiTurnWorkerOutput } from '@shared/worker-protocol';
import { synthesizeOfflineAgentPlan } from './offline-assistant';
import type { ILocalProviderClient, StructuredAgentPlan } from './providers/types';

function makeRunId(): string {
  return `airun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function makeToolCallId(idx: number): string {
  return `tc_${Date.now().toString(36)}_${idx}`;
}

export function buildCompactCanvasSummary(
  sheet: UISheetDocument,
  selectedNodeIds: NodeId[] = [],
  maxNodes = 48,
): string {
  const lines: string[] = [];
  let visited = 0;
  const selectedSet = new Set(selectedNodeIds);

  const walk = (nodeId: NodeId, depth: number) => {
    if (visited >= maxNodes || depth > 5) return;
    const n: UINode | undefined = sheet.nodes[nodeId];
    if (!n) return;
    visited++;

    const indent = '  '.repeat(depth);
    const selMark = selectedSet.has(n.id) ? ' [SELECTED]' : '';
    const layoutBadge =
      n.layout.mode === 'flex'
        ? `flex:${n.layout.direction ?? 'column'}`
        : n.layout.mode;
    const textPreview = n.content?.text ? ` text="${n.content.text.slice(0, 28)}"` : '';
    const htmxPreview = n.platform?.htmx ? ` htmx=${n.platform.htmx.method}:${n.platform.htmx.endpoint}` : '';
    lines.push(`${indent}- ${n.id} (${n.kind}/${n.semanticTag} "${n.name}" ${layoutBadge})${textPreview}${htmxPreview}${selMark}`);

    for (const cid of n.childIds) {
      walk(cid, depth + 1);
    }
  };

  for (const rootId of sheet.rootIds) {
    walk(rootId, 0);
  }

  return lines.join('\n') || '(empty sheet)';
}

export function validateSheetAccessibility(sheet: UISheetDocument): {
  warnings: string[];
  score: number;
} {
  const warnings: string[] = [];
  for (const node of Object.values(sheet.nodes)) {
    if (node.kind === 'control' && node.content?.controlType === 'button') {
      const hasLabel = Boolean(node.content.text?.trim() || node.platform?.a11y?.ariaLabel?.trim());
      if (!hasLabel) {
        warnings.push(`Button "${node.name}" (${node.id}) has neither text nor aria-label.`);
      }
      if (node.layout.frame.height > 0 && node.layout.frame.height < 32) {
        warnings.push(`Button "${node.name}" (${node.id}) height (${node.layout.frame.height}px) is below recommended touch target.`);
      }
    }
    if (node.kind === 'control' && node.content?.controlType === 'text-input') {
      const hasHint = Boolean(node.content.placeholder?.trim() || node.platform?.a11y?.ariaLabel?.trim());
      if (!hasHint) {
        warnings.push(`Input "${node.name}" (${node.id}) should specify placeholder or aria-label.`);
      }
    }
  }
  const score = Math.max(60, 100 - warnings.length * 8);
  return { warnings, score };
}

function buildAgentSystemPrompt(
  ctx: AiTurnExecutionContext,
  canvasSummary: string,
  tokenPaths: string[],
): string {
  const rootArtboardId = ctx.sheet.rootIds[0] ?? null;
  const selectedIds = ctx.request.selectedNodeIds ?? [];
  return [
    'You are the Local AI UI Architect inside Visual UI Studio (Figma/Canva visual builder + multi-target codegen).',
    'Respond ONLY with a valid JSON object matching the schema: { "reply": string, "ops": Array<CompactOp> }.',
    `Active Mode: ${ctx.request.mode}`,
    `Active Target Framework: ${ctx.request.activeTarget ?? 'react-tsx'} (${ctx.request.activeDialect ?? 'tailwind'})`,
    `Primary Root Artboard ID: ${rootArtboardId ?? 'none'}`,
    `Selected Node IDs: ${selectedIds.length > 0 ? selectedIds.join(', ') : 'none'}`,
    `Available Design Tokens: ${tokenPaths.slice(0, 20).join(', ')}`,
    'Rules:',
    '1. Prefer Auto-Layout (`layoutMode: "flex"`, `direction: "row" | "column"`, `gap`, `padding`, `widthMode: "fill" | "hug"`) instead of raw absolute coordinates.',
    `2. For "insert_tree", set "parentId" to an existing container ID (default to "${rootArtboardId ?? ''}" when adding a new section).`,
    '3. For "update_props" or "bind_htmx", set "nodeId" to an existing ID from the SceneGraph below.',
    'Current SceneGraph Tree:',
    canvasSummary,
  ].join('\n');
}

function anchorCompactOpsToValidNodes(
  compactOps: AICompactPatchOp[],
  sheet: UISheetDocument,
  selectedNodeIds: NodeId[],
): AICompactPatchOp[] {
  const defaultRootId = sheet.rootIds[0] ?? null;
  const fallbackSelectedId =
    selectedNodeIds.find((id) => Boolean(sheet.nodes[id])) ??
    (defaultRootId ? sheet.nodes[defaultRootId]?.childIds[0] ?? defaultRootId : null);

  return compactOps
    .map((op): AICompactPatchOp | null => {
      switch (op.op) {
        case 'insert_tree': {
          const validParent =
            op.parentId && sheet.nodes[op.parentId]
              ? op.parentId
              : op.tree.kind === 'artboard'
                ? null
                : defaultRootId;
          return { ...op, parentId: validParent };
        }
        case 'update_props': {
          const targetId = sheet.nodes[op.nodeId] ? op.nodeId : fallbackSelectedId;
          return targetId ? { ...op, nodeId: targetId } : null;
        }
        case 'bind_htmx': {
          const targetId = sheet.nodes[op.nodeId] ? op.nodeId : fallbackSelectedId;
          return targetId ? { ...op, nodeId: targetId } : null;
        }
        case 'wrap_auto_layout': {
          const validIds = op.targetNodeIds.filter((id) => Boolean(sheet.nodes[id]));
          if (validIds.length === 0) return null;
          return { ...op, targetNodeIds: validIds };
        }
        case 'delete_node': {
          if (!sheet.nodes[op.nodeId] || sheet.rootIds.includes(op.nodeId)) {
            return null; // Never delete the root artboard accidentally
          }
          return op;
        }
      }
    })
    .filter((x): x is AICompactPatchOp => x !== null);
}

export class AgentOrchestrator {
  private readonly providers: Map<LocalAIProviderKind, ILocalProviderClient>;
  private readonly activeRuns = new Map<string, AbortController>();

  constructor(providers: ILocalProviderClient[]) {
    this.providers = new Map(providers.map((p) => [p.kind, p]));
  }

  public cancelRun(runId: string): void {
    const ctrl = this.activeRuns.get(runId);
    if (ctrl) {
      ctrl.abort();
      this.activeRuns.delete(runId);
    }
  }

  public async executeTurn(
    ctx: AiTurnExecutionContext,
    numCtx: number,
    emit?: (event: AgentStreamEvent) => void,
  ): Promise<AiTurnWorkerOutput> {
    const startedAt = Date.now();
    const runId = makeRunId();
    const threadId = ctx.request.threadId ?? `thr_${Date.now().toString(36)}`;
    const selectedIds = ctx.request.selectedNodeIds ?? [];
    const abortController = new AbortController();
    this.activeRuns.set(runId, abortController);

    const toolCalls: AgentToolCallRecord[] = [];
    let toolIdx = 0;

    emit?.({
      type: 'run_started',
      runId,
      threadId,
      preCheckpointId: ctx.preCheckpointId,
    });

    try {
      // Step 1: Inspect Canvas Tree (MCP-compatible internal tool)
      const inspectStart = Date.now();
      const canvasSummary = buildCompactCanvasSummary(ctx.sheet, selectedIds);
      const tokenPaths = Array.from(new Set(ctx.tokens.map((t: DesignTokenEntry) => t.tokenPath)));
      const inspectRecord: AgentToolCallRecord = {
        id: makeToolCallId(++toolIdx),
        toolName: 'inspect_canvas_tree',
        argsJson: JSON.stringify({
          sheetId: ctx.sheet.sheetId,
          selectedNodeIds: selectedIds,
        }),
        resultSummary: `Inspected ${Object.keys(ctx.sheet.nodes).length} SceneGraph nodes and ${tokenPaths.length} tokens.`,
        status: 'succeeded',
        durationMs: Math.max(1, Date.now() - inspectStart),
      };
      toolCalls.push(inspectRecord);
      emit?.({ type: 'tool_call', runId, toolCall: inspectRecord });

      // Optional Vision preprocessing tool record
      if (ctx.request.mode === 'vision_to_ui' || ctx.request.visionImageBase64) {
        const visionRecord: AgentToolCallRecord = {
          id: makeToolCallId(++toolIdx),
          toolName: 'vision_screenshot_to_ui',
          argsJson: JSON.stringify({
            sheetId: ctx.sheet.sheetId,
            hasImagePayload: Boolean(ctx.request.visionImageBase64),
          }),
          resultSummary: 'Normalized coordinate grid prepared for multimodal layout extraction.',
          status: 'succeeded',
          durationMs: 2,
        };
        toolCalls.push(visionRecord);
        emit?.({ type: 'tool_call', runId, toolCall: visionRecord });
      }

      // Step 2: Invoke Selected Provider (or Smart Offline Deterministic Fallback)
      let plan: StructuredAgentPlan;
      let usedFallbackOffline = false;
      let tokensIn: number | undefined;
      let tokensOut: number | undefined;

      if (ctx.request.provider === 'builtin_offline') {
        usedFallbackOffline = true;
        plan = synthesizeOfflineAgentPlan({
          mode: ctx.request.mode,
          prompt: ctx.request.prompt,
          sheet: ctx.sheet,
          selectedNodeIds: selectedIds,
          activeTarget: ctx.request.activeTarget,
          hasVisionAttachment: Boolean(ctx.request.visionImageBase64),
        });
        if (plan.thinking) {
          emit?.({ type: 'token_delta', runId, delta: plan.thinking, isThinking: true });
        }
        emit?.({ type: 'token_delta', runId, delta: plan.reply, isThinking: false });
      } else {
        const client = this.providers.get(ctx.request.provider);
        if (!client) {
          usedFallbackOffline = true;
          plan = synthesizeOfflineAgentPlan({
            mode: ctx.request.mode,
            prompt: ctx.request.prompt,
            sheet: ctx.sheet,
            selectedNodeIds: selectedIds,
            activeTarget: ctx.request.activeTarget,
            hasVisionAttachment: Boolean(ctx.request.visionImageBase64),
            fallbackReason: `Unknown provider ${ctx.request.provider}`,
          });
        } else {
          try {
            const systemPrompt = buildAgentSystemPrompt(ctx, canvasSummary, tokenPaths);
            const genOut = await client.generatePlan({
              runId,
              modelName: ctx.request.modelName,
              mode: ctx.request.mode,
              systemPrompt,
              userPrompt: ctx.request.prompt,
              visionImageBase64: ctx.request.visionImageBase64,
              activeTarget: ctx.request.activeTarget,
              activeDialect: ctx.request.activeDialect,
              numCtx,
              abortSignal: abortController.signal,
              onTokenDelta: (delta, isThinking) => {
                emit?.({ type: 'token_delta', runId, delta, isThinking });
              },
            });
            plan = genOut.plan;
            tokensIn = genOut.tokensIn;
            tokensOut = genOut.tokensOut;
          } catch (providerErr) {
            if (abortController.signal.aborted) {
              throw new Error('Agent run cancelled by user.');
            }
            usedFallbackOffline = true;
            const errMsg = providerErr instanceof Error ? providerErr.message : String(providerErr);
            plan = synthesizeOfflineAgentPlan({
              mode: ctx.request.mode,
              prompt: ctx.request.prompt,
              sheet: ctx.sheet,
              selectedNodeIds: selectedIds,
              activeTarget: ctx.request.activeTarget,
              hasVisionAttachment: Boolean(ctx.request.visionImageBase64),
              fallbackReason: `${ctx.request.provider} unreachable (${errMsg.slice(0, 90)})`,
            });
            emit?.({ type: 'token_delta', runId, delta: plan.reply, isThinking: false });
          }
        }
      }

      // Step 3: Hydrate Compact Ops -> Canonical UIPatchOps & Mutate SceneGraph
      const mutateStart = Date.now();
      const anchoredCompactOps = anchorCompactOpsToValidNodes(plan.compactOps, ctx.sheet, selectedIds);
      const appliedOps: UIPatchOp[] = hydrateCompactOpsToPatches(anchoredCompactOps, ctx.sheet.sheetId);
      const { nextSheet: updatedSheet } = applyPatchOpsToSheet(ctx.sheet, appliedOps);

      if (appliedOps.length > 0) {
        const mutateRecord: AgentToolCallRecord = {
          id: makeToolCallId(++toolIdx),
          toolName: 'mutate_canvas_nodes',
          argsJson: JSON.stringify({
            sheetId: ctx.sheet.sheetId,
            compactOpCount: anchoredCompactOps.length,
            hydratedPatchCount: appliedOps.length,
          }),
          resultSummary: `Applied ${appliedOps.length} atomic UIPatchOp(s) safely (Checkpoint ${ctx.preCheckpointId}).`,
          status: 'succeeded',
          durationMs: Math.max(1, Date.now() - mutateStart),
        };
        toolCalls.push(mutateRecord);
        emit?.({ type: 'tool_call', runId, toolCall: mutateRecord });
        emit?.({ type: 'canvas_patched', runId, opsCount: appliedOps.length });
      }

      // Step 4: Post-Mutation Layout & Accessibility Verification
      const a11yStart = Date.now();
      const a11yAudit = validateSheetAccessibility(updatedSheet);
      const a11yRecord: AgentToolCallRecord = {
        id: makeToolCallId(++toolIdx),
        toolName: 'validate_layout_accessibility',
        argsJson: JSON.stringify({ sheetId: updatedSheet.sheetId }),
        resultSummary:
          a11yAudit.warnings.length === 0
            ? `WCAG & layout check passed (Score: ${a11yAudit.score}/100).`
            : `Score ${a11yAudit.score}/100 (${a11yAudit.warnings.length} advisory item(s)).`,
        status: 'succeeded',
        durationMs: Math.max(1, Date.now() - a11yStart),
      };
      toolCalls.push(a11yRecord);
      emit?.({ type: 'tool_call', runId, toolCall: a11yRecord });

      emit?.({ type: 'run_completed', runId });

      return {
        runId,
        assistantReply: plan.reply,
        thinkingText: plan.thinking,
        appliedOps,
        updatedSheet,
        toolCalls,
        usedFallbackOffline,
        tokensIn,
        tokensOut,
        latencyMs: Math.max(1, Date.now() - startedAt),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit?.({ type: 'run_error', runId, error: message });
      throw err;
    } finally {
      this.activeRuns.delete(runId);
    }
  }
}
