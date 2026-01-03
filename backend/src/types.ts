// ============================================
// Task Recorder Backend - Types
// ============================================

// Action types captured by the content script
export type ActionType = 'click' | 'input' | 'navigation' | 'copy' | 'scroll';

// Pattern types detected during analysis
export type PatternType = 'back_forth' | 'long_pause' | 'repeated_action' | 'exploration';

// Session status
export type SessionStatus = 'recording' | 'processing' | 'completed' | 'error';

// LLM Provider
export type LLMProvider = 'claude' | 'openai';

// ============================================
// Core Action Interface
// ============================================

export interface ActionTarget {
  selector: string;
  text: string;
  role?: string;
}

export interface ActionMetadata {
  pageTitle: string;
  h1?: string;
  idleTimeBefore?: number;
}

export interface Action {
  type: ActionType;
  timestamp: number;
  url: string;
  target: ActionTarget;
  metadata: ActionMetadata;
}

// ============================================
// Chunk Interfaces
// ============================================

export interface ActionChunk {
  phase: string;
  startIndex: number;
  endIndex: number;
  actions: Action[];
  patterns: PatternType[];
  inferredIntent?: string;
}

// ============================================
// Know-How Extraction
// ============================================

export interface DecisionCriterion {
  situation: string;
  criterion: string;
  sourcePattern: PatternType;
  confidence: number;
}

export interface CornerCase {
  situation: string;
  resolution: string;
  sourceEvidence: string;
}

export interface KnowHowExtraction {
  decisionCriteria: DecisionCriterion[];
  successSignals: string[];
  failureSignals: string[];
  criticalFields: string[];
  cornerCases: CornerCase[];
  expertShortcuts: string[];
}

// ============================================
// Task Metrics
// ============================================

export interface PauseInfo {
  index: number;
  durationMs: number;
}

export interface BackForthPattern {
  indices: number[];
}

export interface RepeatedActionInfo {
  type: ActionType;
  count: number;
  indices: number[];
}

export interface ExtractionAction {
  index: number;
  context: string;
}

export interface TaskMetrics {
  totalActions: number;
  totalDurationMs: number;
  longPauses: PauseInfo[];
  backForthPatterns: BackForthPattern[];
  repeatedActions: RepeatedActionInfo[];
  extractionActions: ExtractionAction[];
  urlChanges: number;
  uniqueDomains: string[];
}

// ============================================
// Generated Output
// ============================================

export interface GeneratedOutput {
  summary: string;
  instructions: string;
  knowHow: string;
  rawMarkdown: string;
}

// ============================================
// Task Session
// ============================================

export interface NarrationSegment {
  text: string;
  start: number;
  end: number;
}

export interface TaskSession {
  id: string;
  status: SessionStatus;
  startTs: number;
  endTs?: number;
  actions: Action[];
  chunks?: ActionChunk[];
  metrics?: TaskMetrics;
  knowHowExtraction?: KnowHowExtraction;
  output?: GeneratedOutput;
  error?: string;
  // Audio narration
  narration?: string;
  narrationSegments?: NarrationSegment[];
  // Clarification conversation transcript
  clarificationTranscript?: string;
}

// ============================================
// API Types
// ============================================

export interface CreateTaskResponse {
  taskId: string;
  status: SessionStatus;
}

export interface AddActionsRequest {
  actions: Action[];
}

export interface AddActionsResponse {
  received: number;
  total: number;
}

export interface StopTaskResponse {
  status: SessionStatus;
  output?: GeneratedOutput;
  error?: string;
}

export interface GetTaskResponse {
  task: TaskSession;
}

// ============================================
// LLM Types
// ============================================

export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
}

export interface ChunkerOutput {
  chunks: ActionChunk[];
}

export interface AnalyzerOutput {
  knowHow: KnowHowExtraction;
}

export interface GeneratorOutput {
  markdown: string;
}

