// ============================================
// Task Recorder Backend - Documentation Generator
// Orchestrates the 3-prompt pipeline
// ============================================

import type {
  TaskSession,
  ActionChunk,
  TaskMetrics,
  KnowHowExtraction,
  GeneratedOutput,
  PatternType,
} from '../types.js';

import {
  calculateMetrics,
  formatActionsForLLM,
  formatMetricsForLLM,
} from './processor.js';

import { complete } from './llm.js';

import {
  buildChunkerPrompt,
  parseChunkerResponse,
} from '../prompts/chunker.js';

import {
  buildAnalyzerPrompt,
  parseAnalyzerResponse,
} from '../prompts/analyzer.js';

import {
  buildGeneratorPrompt,
  parseGeneratorResponse,
} from '../prompts/markdown-generator.js';

// ============================================
// Types
// ============================================

export interface GenerationResult {
  chunks: ActionChunk[];
  metrics: TaskMetrics;
  knowHow: KnowHowExtraction;
  output: GeneratedOutput;
}

// ============================================
// Main Generation Function
// ============================================

/**
 * Generate documentation from a recorded task session
 * Uses a 3-stage LLM pipeline: Chunker -> Analyzer -> Generator
 */
export async function generateDocumentation(
  task: TaskSession
): Promise<GenerationResult> {
  console.log(`[Generator] Starting documentation generation for task ${task.id}`);
  console.log(`[Generator] Processing ${task.actions.length} actions`);

  // Handle empty actions
  if (task.actions.length === 0) {
    return createEmptyResult();
  }

  // Step 1: Calculate metrics
  console.log('[Generator] Step 1: Calculating metrics...');
  const metrics = calculateMetrics(task.actions);

  // Format data for LLM
  const actionsJson = formatActionsForLLM(task.actions);
  const metricsJson = formatMetricsForLLM(metrics);

  // Step 2: Chunker - Segment actions into semantic phases
  console.log('[Generator] Step 2: Running Chunker...');
  const { systemPrompt: chunkerSystem, userPrompt: chunkerUser } = buildChunkerPrompt(actionsJson, metricsJson);
  const chunkerResponse = await complete(chunkerUser, { 
    systemPrompt: chunkerSystem,
    maxTokens: 2048 
  });
  const chunkerParsed = parseChunkerResponse(chunkerResponse);

  // Convert chunks to our internal format
  const chunks: ActionChunk[] = chunkerParsed.chunks.map(chunk => ({
    phase: chunk.phase,
    startIndex: chunk.startIndex,
    endIndex: chunk.endIndex,
    actions: task.actions.slice(chunk.startIndex, chunk.endIndex + 1),
    patterns: chunk.patterns as PatternType[],
    inferredIntent: chunk.inferredIntent,
  }));

  console.log(`[Generator] Chunker produced ${chunks.length} chunks`);

  // Format chunks for next step
  const chunksJson = JSON.stringify(
    chunks.map(c => ({
      phase: c.phase,
      startIndex: c.startIndex,
      endIndex: c.endIndex,
      patterns: c.patterns,
      inferredIntent: c.inferredIntent,
      actionCount: c.actions.length,
      // Include sample actions for context
      sampleActions: c.actions.slice(0, 3).map(a => ({
        type: a.type,
        text: a.target.text.slice(0, 30),
        pageTitle: a.metadata.pageTitle,
      })),
    })),
    null,
    2
  );

  // Step 3: Analyzer - Extract know-how from patterns
  console.log('[Generator] Step 3: Running Analyzer...');
  const { systemPrompt: analyzerSystem, userPrompt: analyzerUser } = buildAnalyzerPrompt(chunksJson, actionsJson, metricsJson);
  const analyzerResponse = await complete(analyzerUser, { 
    systemPrompt: analyzerSystem,
    maxTokens: 2048 
  });
  const analyzerParsed = parseAnalyzerResponse(analyzerResponse);

  // Convert know-how to our internal format
  const knowHow: KnowHowExtraction = {
    decisionCriteria: analyzerParsed.knowHow.decision_criteria.map(dc => ({
      situation: dc.situation,
      criterion: dc.criterion,
      sourcePattern: dc.source_pattern as PatternType,
      confidence: dc.confidence,
    })),
    successSignals: analyzerParsed.knowHow.success_signals,
    failureSignals: analyzerParsed.knowHow.failure_signals,
    criticalFields: analyzerParsed.knowHow.critical_fields,
    cornerCases: analyzerParsed.knowHow.corner_cases.map(cc => ({
      situation: cc.situation,
      resolution: cc.resolution,
      sourceEvidence: cc.source_evidence,
    })),
    expertShortcuts: analyzerParsed.knowHow.expert_shortcuts,
  };

  console.log(`[Generator] Analyzer extracted ${knowHow.decisionCriteria.length} decision criteria`);

  // Format know-how for next step
  const knowHowJson = JSON.stringify(analyzerParsed.knowHow, null, 2);

  // Step 4: Generator - Create final Markdown
  console.log('[Generator] Step 4: Running Generator...');
  const { systemPrompt: generatorSystem, userPrompt: generatorUser } = buildGeneratorPrompt(chunksJson, knowHowJson, metricsJson);
  const generatorResponse = await complete(generatorUser, { 
    systemPrompt: generatorSystem,
    maxTokens: 4096 
  });
  const generatorParsed = parseGeneratorResponse(generatorResponse);

  const output: GeneratedOutput = {
    summary: generatorParsed.summary,
    instructions: generatorParsed.instructions,
    knowHow: generatorParsed.knowHow,
    rawMarkdown: generatorParsed.rawMarkdown,
  };

  console.log('[Generator] Documentation generation complete');

  return {
    chunks,
    metrics,
    knowHow,
    output,
  };
}

// ============================================
// Fallback for Empty Tasks
// ============================================

function createEmptyResult(): GenerationResult {
  return {
    chunks: [],
    metrics: {
      totalActions: 0,
      totalDurationMs: 0,
      longPauses: [],
      backForthPatterns: [],
      repeatedActions: [],
      extractionActions: [],
      urlChanges: 0,
      uniqueDomains: [],
    },
    knowHow: {
      decisionCriteria: [],
      successSignals: [],
      failureSignals: [],
      criticalFields: [],
      cornerCases: [],
      expertShortcuts: [],
    },
    output: {
      summary: 'No actions were recorded.',
      instructions: 'No steps to document.',
      knowHow: 'No know-how extracted.',
      rawMarkdown: `# Summary

No actions were recorded.

# Instructions

No steps to document.

# Know-How

No know-how extracted.`,
    },
  };
}

// ============================================
// Debug/Test Functions
// ============================================

/**
 * Generate documentation with mock LLM (for testing)
 */
export async function generateDocumentationMock(
  task: TaskSession
): Promise<GenerationResult> {
  console.log('[Generator] Using MOCK generation');

  const metrics = calculateMetrics(task.actions);

  // Create mock chunks from actions
  const chunks: ActionChunk[] = [{
    phase: 'Complete Task',
    startIndex: 0,
    endIndex: task.actions.length - 1,
    actions: task.actions,
    patterns: [],
    inferredIntent: 'Execute the recorded task',
  }];

  const knowHow: KnowHowExtraction = {
    decisionCriteria: [],
    successSignals: ['Task completed successfully'],
    failureSignals: ['Error occurred'],
    criticalFields: [],
    cornerCases: [],
    expertShortcuts: [],
  };

  const rawMarkdown = `# Summary

This task was recorded with ${task.actions.length} actions over ${Math.round(metrics.totalDurationMs / 1000)} seconds.

# Instructions

1. Follow the recorded steps
2. Verify completion

# Know-How

## Signals
- Success: Task completed successfully
- Failure: Error occurred`;

  return {
    chunks,
    metrics,
    knowHow,
    output: {
      summary: `This task was recorded with ${task.actions.length} actions.`,
      instructions: '1. Follow the recorded steps\n2. Verify completion',
      knowHow: '## Signals\n- Success: Task completed successfully',
      rawMarkdown,
    },
  };
}

