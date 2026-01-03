// ============================================
// Task Recorder Backend - Action Processor
// Processes raw actions into chunks and metrics
// ============================================

import type {
  Action,
  ActionType,
  TaskMetrics,
  PauseInfo,
  BackForthPattern,
  RepeatedActionInfo,
  ExtractionAction,
} from '../types.js';

// ============================================
// Configuration
// ============================================

const LONG_PAUSE_THRESHOLD_MS = 10000; // 10 seconds
const CHUNK_PAUSE_THRESHOLD_MS = 15000; // 15 seconds for chunk boundary
const REPEATED_ACTION_THRESHOLD = 3; // 3+ same actions in sequence

// ============================================
// Metrics Calculation
// ============================================

/**
 * Calculate task metrics from raw actions
 */
export function calculateMetrics(actions: Action[]): TaskMetrics {
  if (actions.length === 0) {
    return {
      totalActions: 0,
      totalDurationMs: 0,
      longPauses: [],
      backForthPatterns: [],
      repeatedActions: [],
      extractionActions: [],
      urlChanges: 0,
      uniqueDomains: [],
    };
  }

  const longPauses = detectLongPauses(actions);
  const backForthPatterns = detectBackForthPatterns(actions);
  const repeatedActions = detectRepeatedActions(actions);
  const extractionActions = detectExtractionActions(actions);
  const { urlChanges, uniqueDomains } = analyzeUrls(actions);

  const firstAction = actions[0];
  const lastAction = actions[actions.length - 1];
  const totalDurationMs = lastAction.timestamp - firstAction.timestamp;

  return {
    totalActions: actions.length,
    totalDurationMs,
    longPauses,
    backForthPatterns,
    repeatedActions,
    extractionActions,
    urlChanges,
    uniqueDomains,
  };
}

/**
 * Detect long pauses (decision points)
 */
function detectLongPauses(actions: Action[]): PauseInfo[] {
  const pauses: PauseInfo[] = [];

  for (let i = 0; i < actions.length; i++) {
    const idleTime = actions[i].metadata.idleTimeBefore;
    if (idleTime && idleTime >= LONG_PAUSE_THRESHOLD_MS) {
      pauses.push({
        index: i,
        durationMs: idleTime,
      });
    }
  }

  return pauses;
}

/**
 * Detect back-forth navigation patterns (exploration/comparison)
 */
function detectBackForthPatterns(actions: Action[]): BackForthPattern[] {
  const patterns: BackForthPattern[] = [];
  const urlHistory: { url: string; index: number }[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const currentUrl = action.url;

    // Check if we've seen this URL before recently
    const previousOccurrence = urlHistory.find(
      (h, idx) => h.url === currentUrl && idx < urlHistory.length - 1
    );

    if (previousOccurrence && urlHistory.length > 0) {
      // This is a back-forth pattern
      const intermediateIndices = urlHistory
        .slice(urlHistory.findIndex(h => h === previousOccurrence) + 1)
        .map(h => h.index);

      if (intermediateIndices.length > 0) {
        patterns.push({
          indices: [previousOccurrence.index, ...intermediateIndices, i],
        });
      }
    }

    urlHistory.push({ url: currentUrl, index: i });

    // Keep only last 10 URLs to avoid memory issues
    if (urlHistory.length > 10) {
      urlHistory.shift();
    }
  }

  return patterns;
}

/**
 * Detect repeated actions (errors or iteration)
 */
function detectRepeatedActions(actions: Action[]): RepeatedActionInfo[] {
  const result: RepeatedActionInfo[] = [];
  let currentType: ActionType | null = null;
  let currentIndices: number[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];

    if (action.type === currentType) {
      currentIndices.push(i);
    } else {
      // Save previous sequence if it meets threshold
      if (currentType && currentIndices.length >= REPEATED_ACTION_THRESHOLD) {
        result.push({
          type: currentType,
          count: currentIndices.length,
          indices: [...currentIndices],
        });
      }

      // Start new sequence
      currentType = action.type;
      currentIndices = [i];
    }
  }

  // Check last sequence
  if (currentType && currentIndices.length >= REPEATED_ACTION_THRESHOLD) {
    result.push({
      type: currentType,
      count: currentIndices.length,
      indices: currentIndices,
    });
  }

  return result;
}

/**
 * Detect extraction actions (copy events)
 */
function detectExtractionActions(actions: Action[]): ExtractionAction[] {
  return actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => action.type === 'copy')
    .map(({ action, index }) => ({
      index,
      context: `${action.metadata.pageTitle} - ${action.target.text}`,
    }));
}

/**
 * Analyze URL patterns
 */
function analyzeUrls(actions: Action[]): {
  urlChanges: number;
  uniqueDomains: string[];
} {
  let urlChanges = 0;
  let lastUrl = '';
  const domains = new Set<string>();

  for (const action of actions) {
    if (action.url !== lastUrl) {
      urlChanges++;
      lastUrl = action.url;

      try {
        const url = new URL(action.url);
        domains.add(url.hostname);
      } catch {
        // Invalid URL, skip
      }
    }
  }

  return {
    urlChanges,
    uniqueDomains: Array.from(domains),
  };
}

// ============================================
// Pre-Chunking (Deterministic)
// ============================================

export interface PreChunk {
  startIndex: number;
  endIndex: number;
  actions: Action[];
  boundary: 'url_change' | 'long_pause' | 'mode_change' | 'start';
}

type ActionMode = 'navigation' | 'interaction' | 'extraction';

function getActionMode(type: ActionType): ActionMode {
  switch (type) {
    case 'navigation':
    case 'scroll':
      return 'navigation';
    case 'copy':
      return 'extraction';
    default:
      return 'interaction';
  }
}

/**
 * Pre-chunk actions based on deterministic rules
 * This creates initial boundaries that the LLM will refine
 */
export function preChunkActions(actions: Action[]): PreChunk[] {
  if (actions.length === 0) return [];

  const chunks: PreChunk[] = [];
  let currentChunkStart = 0;
  let lastUrl = actions[0].url;
  let lastMode = getActionMode(actions[0].type);

  function createChunk(endIndex: number, boundary: PreChunk['boundary']): void {
    if (endIndex >= currentChunkStart) {
      chunks.push({
        startIndex: currentChunkStart,
        endIndex,
        actions: actions.slice(currentChunkStart, endIndex + 1),
        boundary,
      });
      currentChunkStart = endIndex + 1;
    }
  }

  for (let i = 1; i < actions.length; i++) {
    const action = actions[i];
    const idleTime = action.metadata.idleTimeBefore || 0;
    const currentMode = getActionMode(action.type);

    // Check for chunk boundaries
    let shouldSplit = false;
    let boundary: PreChunk['boundary'] = 'start';

    // Long pause - decision point
    if (idleTime >= CHUNK_PAUSE_THRESHOLD_MS) {
      shouldSplit = true;
      boundary = 'long_pause';
    }
    // URL domain change
    else if (action.url !== lastUrl) {
      try {
        const lastDomain = new URL(lastUrl).hostname;
        const currentDomain = new URL(action.url).hostname;
        if (lastDomain !== currentDomain) {
          shouldSplit = true;
          boundary = 'url_change';
        }
      } catch {
        // Invalid URL, check for any URL change
        shouldSplit = true;
        boundary = 'url_change';
      }
    }
    // Mode change (navigation -> interaction -> extraction)
    else if (currentMode !== lastMode) {
      shouldSplit = true;
      boundary = 'mode_change';
    }

    if (shouldSplit) {
      createChunk(i - 1, boundary);
    }

    lastUrl = action.url;
    lastMode = currentMode;
  }

  // Create final chunk
  if (currentChunkStart < actions.length) {
    createChunk(actions.length - 1, 'start');
  }

  return chunks;
}

// ============================================
// Formatting for LLM
// ============================================

/**
 * Format actions for LLM consumption
 */
export function formatActionsForLLM(actions: Action[]): string {
  return JSON.stringify(
    actions.map((action, index) => ({
      index,
      type: action.type,
      timestamp: action.timestamp,
      url: action.url,
      target: {
        selector: action.target.selector,
        text: action.target.text.slice(0, 50), // Truncate long text
        role: action.target.role,
      },
      metadata: {
        pageTitle: action.metadata.pageTitle,
        h1: action.metadata.h1,
        idleTimeBefore: action.metadata.idleTimeBefore,
      },
    })),
    null,
    2
  );
}

/**
 * Format metrics for LLM consumption
 */
export function formatMetricsForLLM(metrics: TaskMetrics): string {
  return JSON.stringify(
    {
      totalActions: metrics.totalActions,
      totalDurationMs: metrics.totalDurationMs,
      totalDurationMinutes: Math.round(metrics.totalDurationMs / 60000 * 10) / 10,
      longPausesCount: metrics.longPauses.length,
      longPauses: metrics.longPauses.map(p => ({
        atAction: p.index,
        durationSeconds: Math.round(p.durationMs / 1000),
      })),
      backForthPatternsCount: metrics.backForthPatterns.length,
      repeatedActionsCount: metrics.repeatedActions.length,
      repeatedActions: metrics.repeatedActions.map(r => ({
        type: r.type,
        count: r.count,
      })),
      extractionsCount: metrics.extractionActions.length,
      extractions: metrics.extractionActions.map(e => e.context),
      urlChanges: metrics.urlChanges,
      uniqueDomains: metrics.uniqueDomains,
    },
    null,
    2
  );
}

