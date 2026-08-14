/**
 * StatusBarService — manages the VS Code status bar item for quota display.
 * Includes context window percentage inline with the active model.
 */

import * as vscode from 'vscode';
import { ClientModelConfig, LocalQuotaData } from '../types';
import { fmtBig, formatDurationMs } from '../shared/helpers';
import { CTX_CRITICAL_PCT, CTX_WARNING_PCT } from '../shared/uiConstants';

export class StatusBarService {
    private readonly statusBarItem: vscode.StatusBarItem;

    // Cached state for re-rendering when either quota or context changes
    private lastQuotaData: LocalQuotaData | null = null;
    private lastSelectedIds: string[] = [];
    private ctxUsed = 0;
    private ctxMax = 0;
    private ctxModel = '';
    private ctxHideTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'ag.refreshQuota';
        this.statusBarItem.text = '$(pulse) Antigravity Quota: Loading...';
        this.statusBarItem.show();
        context.subscriptions.push(this.statusBarItem);
    }

    /** Set error state on status bar */
    setError(text: string, tooltip?: string): void {
        this.statusBarItem.text = text;
        if (tooltip) this.statusBarItem.tooltip = tooltip;
    }

    /** Update status bar from quota data */
    update(data: LocalQuotaData, selectedIds: string[]): void {
        this.lastQuotaData = data;
        this.lastSelectedIds = selectedIds;
        this._render();
    }

    /** Update context window info (shown inline with quota) */
    updateContext(usedTokens: number, maxTokens: number, model: string): void {
        this.ctxUsed = usedTokens;
        this.ctxMax = maxTokens;
        this.ctxModel = model;
        this._render();

        // Auto-hide context after 5min idle
        if (this.ctxHideTimer) clearTimeout(this.ctxHideTimer);
        this.ctxHideTimer = setTimeout(() => {
            this.ctxUsed = 0;
            this.ctxMax = 0;
            this._render();
        }, 5 * 60_000);
    }

    // ── Internal render ──

    private _render(): void {
        const data = this.lastQuotaData;
        const selectedIds = this.lastSelectedIds;

        const rawConfigs = data?.userStatus?.cascadeModelConfigData?.clientModelConfigs;
        if (!rawConfigs || rawConfigs.length === 0) return;

        // Group into Claude (including GPT) and Gemini
        const claudeConfigs: ClientModelConfig[] = [];
        const geminiConfigs: ClientModelConfig[] = [];

        for (const m of rawConfigs) {
            if (!m.quotaInfo) continue;
            const text = `${m.modelOrAlias?.model || ''} ${m.label || ''}`.toLowerCase();
            if (text.includes('claude') || text.includes('gpt')) {
                claudeConfigs.push(m);
            } else if (text.includes('gemini')) {
                geminiConfigs.push(m);
            }
        }

        const groups: Array<{ id: string; label: string; pct: number | null; resetTime?: string }> = [];

        if (claudeConfigs.length > 0) {
            let minPct: number | null = null;
            let resetTime = '';
            for (const m of claudeConfigs) {
                const pct = getQuotaPercent(m);
                if (pct !== null) {
                    if (minPct === null || pct < minPct) {
                        minPct = pct;
                        resetTime = m.quotaInfo?.resetTime || resetTime;
                    }
                }
            }
            groups.push({ id: 'claude', label: 'Claude', pct: minPct, resetTime });
        }

        if (geminiConfigs.length > 0) {
            let minPct: number | null = null;
            let resetTime = '';
            for (const m of geminiConfigs) {
                const pct = getQuotaPercent(m);
                if (pct !== null) {
                    if (minPct === null || pct < minPct) {
                        minPct = pct;
                        resetTime = m.quotaInfo?.resetTime || resetTime;
                    }
                }
            }
            groups.push({ id: 'gemini', label: 'Gemini', pct: minPct, resetTime });
        }

        const isClaudeSelected = selectedIds.some(id => id === 'claude' || /claude|gpt/i.test(id));
        const isGeminiSelected = selectedIds.some(id => id === 'gemini' || /gemini/i.test(id));

        const selectedGroups = groups.filter(g => (g.id === 'claude' && isClaudeSelected) || (g.id === 'gemini' && isGeminiSelected));

        // ── Status bar text ──
        if (selectedGroups.length === 0) {
            this.statusBarItem.text = '$(pulse) Quota: No Model Selected';
        } else {
            const parts = selectedGroups.map(g => {
                return `${quotaIcon(g.pct)} ${g.label}: ${g.pct === null ? 'N/A' : g.pct.toFixed(0) + '%'}`;
            });

            // Append context window percentage if active
            if (this.ctxMax > 0 && this.ctxUsed > 0) {
                const ctxPct = Math.min((this.ctxUsed / this.ctxMax) * 100, 100);
                const ctxIcon = ctxPct > CTX_CRITICAL_PCT ? '$(warning)' : '$(symbol-misc)';
                parts.push(`${ctxIcon} ${ctxPct.toFixed(0)}% ctx`);
            }

            this.statusBarItem.text = parts.join('  ·  ');
        }

        // ── Background color from context level ──
        if (this.ctxMax > 0 && this.ctxUsed > 0) {
            const ctxPct = (this.ctxUsed / this.ctxMax) * 100;
            if (ctxPct > CTX_CRITICAL_PCT) {
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            } else if (ctxPct > CTX_WARNING_PCT) {
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            } else {
                this.statusBarItem.backgroundColor = undefined;
            }
        } else {
            this.statusBarItem.backgroundColor = undefined;
        }

        // ── Rich tooltip ──
        const md = new vscode.MarkdownString('', true);
        md.appendMarkdown('**Antigravity Quota Models**\n\n---\n\n');

        for (const g of groups) {
            const isSel = (g.id === 'claude' && isClaudeSelected) || (g.id === 'gemini' && isGeminiSelected);
            const sel = isSel ? ' *(Selected)*' : '';

            const resetDate = g.resetTime ? new Date(g.resetTime) : null;
            const isValid = resetDate && !isNaN(resetDate.getTime());
            const timeStr = isValid
                ? resetDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                : 'Unknown';
            const timeLeft = isValid ? `(${formatDurationMs(resetDate.getTime() - Date.now())} left)` : '';

            md.appendMarkdown(`${quotaIcon(g.pct)} **${g.label}** (${g.pct === null ? 'N/A' : g.pct.toFixed(0) + '%'})${sel}\n\n`);
            md.appendMarkdown(`*Resets:* ${timeStr} ${timeLeft}\n\n---\n\n`);
        }

        // Context window section in tooltip
        if (this.ctxMax > 0 && this.ctxUsed > 0) {
            const ctxPct = Math.min((this.ctxUsed / this.ctxMax) * 100, 100);
            const shortModel = this.ctxModel.split('/').pop() || this.ctxModel;
            md.appendMarkdown(`**Context Window** — ${shortModel}\n\n`);
            md.appendMarkdown(`**${ctxPct.toFixed(1)}%** used · ${fmtBig(this.ctxUsed)} / ${fmtBig(this.ctxMax)} tokens\n\n`);
            md.appendMarkdown(`**Free:** ${fmtBig(this.ctxMax - this.ctxUsed)} tokens\n\n`);
        }

        this.statusBarItem.tooltip = md;
    }
}

// ==================== Standalone Helpers ====================



function getQuotaPercent(m: ClientModelConfig): number | null {
    if (m.quotaInfo?.remainingFraction === undefined) return null;
    return Math.max(0, Math.min(100, m.quotaInfo.remainingFraction * 100));
}

function quotaIcon(pct: number | null): string {
    if (pct === null) return '⚪';
    if (pct >= 100) return '🟢';
    if (pct <= 0) return '🔴';
    return '🟡';
}


