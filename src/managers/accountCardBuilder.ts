/**
 * AccountCardBuilder — Pure function module for constructing pre-processed account cards.
 * No state, no side effects, easily testable. Renderer does zero logic.
 */

import { AccountQuota, AccountCard, ModelCard, LocalQuotaData } from '../types';
import { shortModelName, normalizeModelKey } from '../shared/helpers';
import { parseUserTier, parsePlanStatus } from '../utils/lsTypes';
import { MODEL_DISPLAY_NAMES } from '../constants';

/**
 * Build a normKey → LS label lookup map from local protobuf data.
 * This is the "Rosetta Stone" that bridges LS enum IDs and API keys
 * to a single canonical label.
 *
 * Example map entries:
 *   "claudeopus46thinking" → "Claude Opus 4.6 (Thinking)"
 *   "gemini31prohigh"      → "Gemini 3.1 Pro (High)"
 */
function buildLabelMap(localData: LocalQuotaData | null): Map<string, string> {
    const map = new Map<string, string>();
    const configs = localData?.userStatus?.cascadeModelConfigData?.clientModelConfigs || [];
    for (const m of configs as any[]) {
        const label = m.label;
        if (!label) continue;
        // Index by normalized label (for matching against tracked API keys)
        map.set(normalizeModelKey(label), label);
    }
    return map;
}

/**
 * Resolve a tracked API key to the canonical LS label using the label map.
 * Uses exact normKey match first, then startsWith fallback for edge cases
 * like "claude-sonnet-4-6" matching "Claude Sonnet 4.6 (Thinking)".
 */
function resolveLabel(apiKey: string, labelMap: Map<string, string>): string {
    const norm = normalizeModelKey(apiKey);

    // 1. Exact normKey match
    const exact = labelMap.get(norm);
    if (exact) return exact;

    // 2. startsWith fallback: tracked key might be a prefix of LS label
    //    e.g. "claudesonnet46" (from "claude-sonnet-4-6")
    //    vs   "claudesonnet46thinking" (from "Claude Sonnet 4.6 (Thinking)")
    for (const [normLabel, label] of labelMap) {
        if (normLabel.startsWith(norm) || norm.startsWith(normLabel)) {
            return label;
        }
    }

    // 3. No match → fallback to shortModelName (existing behavior)
    return shortModelName(apiKey);
}

/**
 * Check if a model identifier or label indicates Claude Opus 5.5.
 * Matches:
 *  - Labels: "Claude Opus 5.5", "Claude Opus 5.5 (Low)", "(Medium)", "(High)"
 *  - Slugs: "claude-opus-5-5", "claude-opus-5.5", "claude-opus-5-5-thinking"
 *  - Enum placeholders: MODEL_PLACEHOLDER_M400, M401, M402
 */
export function isOpus55Model(idOrName?: string, label?: string): boolean {
    const text = `${idOrName || ''} ${label || ''}`.toLowerCase();
    if (/opus.*5[.-]?5/i.test(text)) return true;
    if (/model_placeholder_m(400|401|402)\b/i.test(idOrName || '')) return true;
    return false;
}

/**
 * Group raw individual models into 2 canonical groups: 'Claude' (which includes Claude & GPT) and 'Gemini'.
 * Only these 2 groups will be visible in the UI.
 */
export function groupModels(rawModels: ModelCard[]): ModelCard[] {
    const claudeItems: ModelCard[] = [];
    const geminiItems: ModelCard[] = [];

    for (const m of rawModels) {
        const text = `${m.id} ${m.label}`.toLowerCase();
        if (text.includes('claude') || text.includes('gpt')) {
            claudeItems.push(m);
        } else if (text.includes('gemini')) {
            geminiItems.push(m);
        }
    }

    const result: ModelCard[] = [];

    if (claudeItems.length > 0) {
        const bottleneck = claudeItems.reduce((min, cur) => cur.pct < min.pct ? cur : min, claudeItems[0]);
        const resetTime = bottleneck.resetTime || claudeItems.find(i => i.resetTime)?.resetTime || '';
        const hasOpus55 = claudeItems.some(i => i.hasOpus55 || isOpus55Model(i.id, i.label));
        result.push({
            id: 'claude',
            label: 'Claude',
            pct: bottleneck.pct,
            resetTime,
            isLocal: claudeItems[0].isLocal,
            hasOpus55,
        });
    }

    if (geminiItems.length > 0) {
        const bottleneck = geminiItems.reduce((min, cur) => cur.pct < min.pct ? cur : min, geminiItems[0]);
        const resetTime = bottleneck.resetTime || geminiItems.find(i => i.resetTime)?.resetTime || '';
        result.push({
            id: 'gemini',
            label: 'Gemini',
            pct: bottleneck.pct,
            resetTime,
            isLocal: geminiItems[0].isLocal,
        });
    }

    return result;
}

export function buildAccountCards(
    localData: LocalQuotaData | null,
    trackedQuotas: AccountQuota[],
    activeEmailRaw: string,
    switchActive: boolean,
    selectedModels: string[],
): AccountCard[] {
    const activeEmail = (activeEmailRaw || '').toLowerCase();
    const cards: AccountCard[] = [];

    // Build label map from local LS data (Rosetta Stone for cross-source pin matching)
    const labelMap = buildLabelMap(localData);

    const status = localData?.userStatus;
    const localEmail = (status?.email || '').toLowerCase();

    // Normalize selectedModels for status bar toggles ('claude', 'gemini')
    const normalizedSelected: string[] = [];
    if (selectedModels.some(id => id === 'claude' || /claude|gpt/i.test(id))) {
        normalizedSelected.push('claude');
    }
    if (selectedModels.some(id => id === 'gemini' || /gemini/i.test(id))) {
        normalizedSelected.push('gemini');
    }

    if (status) {
        const knownDisplayNames = new Set(Object.values(MODEL_DISPLAY_NAMES));
        const rawConfigs = status.cascadeModelConfigData?.clientModelConfigs || [];
        const rawModels = rawConfigs
            .filter((m: any) => {
                if (!m.quotaInfo) return false;
                const label = m.label || shortModelName(m.modelOrAlias?.model);
                if (knownDisplayNames.has(label)) return true;
                const text = `${label} ${m.modelOrAlias?.model || ''}`.toLowerCase();
                return text.includes('opus') || text.includes('claude') || text.includes('gemini') || text.includes('gpt');
            })
            .sort((a: any, b: any) => (a.label || '').localeCompare(b.label || ''));

        const rawModelCards: ModelCard[] = rawModels.map((m: any) => ({
            id: m.modelOrAlias?.model || m.label,
            label: m.label || shortModelName(m.modelOrAlias?.model),
            pct: m.quotaInfo.remainingFraction !== undefined
                ? Math.max(0, Math.min(100, Math.round(m.quotaInfo.remainingFraction * 100)))
                : 0,
            resetTime: m.quotaInfo.resetTime || '',
            isLocal: true,
            hasOpus55: isOpus55Model(m.modelOrAlias?.model, m.label),
        }));

        const hasOpus55 = rawConfigs.some((m: any) => isOpus55Model(m.modelOrAlias?.model, m.label))
            || rawModelCards.some(m => isOpus55Model(m.id, m.label));

        const models = groupModels(rawModelCards);
        const bottleneckModel = models.length > 0 ? models.reduce((a, b) => a.pct < b.pct ? a : b) : null;
        const userTier = parseUserTier(status.userTier);
        const planStatus = parsePlanStatus(status.planStatus);
        const aiCredits = userTier.availableCredits.find(c => c.creditType === 'GOOGLE_ONE_AI');

        // Intent email ≠ LS email → switch in progress, LS hasn't adopted new identity yet
        const isTransitioning = !!(
            activeEmail && localEmail &&
            activeEmail !== localEmail &&
            switchActive
        );

        cards.push({
            email: status.email || 'active-local',
            isActive: !activeEmail || activeEmail === localEmail,
            isTransitioning,
            pendingEmail: isTransitioning ? activeEmailRaw : undefined,
            hasOpus55,
            models,
            bottleneck: bottleneckModel,
            tierName: userTier.name,
            tierId: userTier.id,
            aiCredits: aiCredits ? parseInt(aiCredits.creditAmount, 10) : null,
            promptCredits: planStatus.availablePromptCredits,
            promptCreditsMax: planStatus.planInfo.monthlyPromptCredits,
            flowCredits: planStatus.availableFlowCredits,
            flowCreditsMax: planStatus.planInfo.monthlyFlowCredits,
            resetTime: bottleneckModel?.resetTime || models[0]?.resetTime || '',
            isError: false,
            selectedModels: normalizedSelected,
            isLocal: true,
        });
    }

    // Dedup: skip tracked account if its email matches local card (local has richer data).
    // During switch A→B: local=A(stale), tracked A must still be deduped.
    const dedupEmail = localEmail || '';

    for (const trackedQuota of trackedQuotas) {
        const trackedEmail = (trackedQuota.account.email || '').toLowerCase();
        if (dedupEmail && trackedEmail === dedupEmail) continue;

        const rawModelCards: ModelCard[] = (trackedQuota.models || []).map(m => ({
            id: m.name,
            label: resolveLabel(m.name, labelMap),
            pct: m.percentage || 0,
            resetTime: m.resetTimeRaw || m.resetTime || '',
            isLocal: false,
            hasOpus55: isOpus55Model(m.name, m.name),
        }));

        const hasOpus55 = (trackedQuota.models || []).some(m => isOpus55Model(m.name, m.name))
            || rawModelCards.some(m => isOpus55Model(m.id, m.label));

        const models = groupModels(rawModelCards);
        const bottleneckModel = models.length > 0 ? models.reduce((a, b) => a.pct < b.pct ? a : b) : null;

        cards.push({
            email: trackedQuota.account.email || 'Unknown',
            name: trackedQuota.account.name,
            isActive: !!(activeEmail && activeEmail === trackedEmail),
            trackingId: trackedQuota.account.id,
            hasOpus55,
            models,
            bottleneck: bottleneckModel,
            tierName: trackedQuota.tierName || trackedQuota.tier || null,
            resetTime: bottleneckModel?.resetTime || '',
            isError: trackedQuota.isError || trackedQuota.isForbidden,
            errorMessage: trackedQuota.isForbidden ? 'Access forbidden' : (trackedQuota.errorMessage || ''),
            selectedModels: [],
            isLocal: false,
            aiCredits: null,
            promptCredits: null,
            promptCreditsMax: null,
            flowCredits: null,
            flowCreditsMax: null,
        });
    }

    cards.sort((a, b) => (a.isActive ? 0 : 1) - (b.isActive ? 0 : 1));
    return cards;
}
