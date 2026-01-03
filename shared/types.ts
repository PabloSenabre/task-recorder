// ============================================
// Task Recorder - Shared Types
// ============================================

// Action types captured by the content script
export type ActionType = 'click' | 'input' | 'navigation' | 'copy' | 'scroll';

// Pattern types detected during analysis
export type PatternType = 'back_forth' | 'long_pause' | 'repeated_action' | 'exploration';

// Session status
export type SessionStatus = 'recording' | 'processing' | 'completed' | 'error';

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
  idleTimeBefore?: number; // ms since previous action
}

export interface Action {
  type: ActionType;
  timestamp: number;
  url: string;
  target: ActionTarget;
  metadata: ActionMetadata;
}

// ============================================
// Chunk Interfaces (from Prompt 1: Chunker)
// ============================================

export interface ActionChunk {
  phase: string; // Semantic label: "Search/Filter", "Data Extraction", etc.
  startIndex: number;
  endIndex: number;
  actions: Action[];
  patterns: PatternType[];
  inferredIntent?: string;
}

// ============================================
// Know-How Extraction (from Prompt 2: Analyzer)
// ============================================

export interface DecisionCriterion {
  situation: string; // "When/If..."
  criterion: string; // "Look for / Check / Verify..."
  sourcePattern: PatternType;
  confidence: number; // 0.7 - 1.0
}

export interface CornerCase {
  situation: string; // "If X happens..."
  resolution: string; // "Do Y instead"
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
// Task Metrics (calculated by Processor)
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
// Generated Output (from Prompt 3: Generator)
// ============================================

export interface GeneratedOutput {
  summary: string;
  instructions: string;
  knowHow: string;
  rawMarkdown: string;
}

// ============================================
// Task Session (main entity)
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
  narration?: string; // Full transcription of user narration
  narrationSegments?: NarrationSegment[]; // Timed segments
}

// ============================================
// API Request/Response Types
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
// Extension Message Types
// ============================================

export type ExtensionMessageType = 
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'ACTION_CAPTURED'
  | 'RECORDING_STATUS'
  | 'GENERATION_COMPLETE'
  | 'ERROR';

export interface ExtensionMessage {
  type: ExtensionMessageType;
  payload?: unknown;
}

export interface RecordingStatusPayload {
  isRecording: boolean;
  taskId?: string;
  actionCount: number;
}

export interface GenerationCompletePayload {
  markdown: string;
  taskId: string;
}

export interface ErrorPayload {
  message: string;
  code?: string;
}

