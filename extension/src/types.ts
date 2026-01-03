// Re-export shared types for extension use
// In production, these would be imported from a shared package

export type ActionType = 'click' | 'input' | 'navigation' | 'copy' | 'scroll';

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

export type ExtensionMessageType = 
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'ACTION_CAPTURED'
  | 'RECORDING_STATUS'
  | 'GENERATION_COMPLETE'
  | 'GET_STATUS'
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

