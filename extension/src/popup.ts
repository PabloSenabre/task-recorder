// ============================================
// Task Recorder - Popup Script
// Controls the extension popup UI
// ============================================

import type { RecordingStatusPayload, GenerationCompletePayload, ErrorPayload, ExtensionMessage } from './types.js';
import { audioRecorder } from './audio-recorder.js';
import { showAgentModal } from './agent-widget.js';

// Agent ID from Eleven Labs
const AGENT_ID = 'agent_4801ke0jpqkdf8pa17y612q7vhgq';

// API Base URL
const API_BASE_URL = 'http://localhost:3000';

// ============================================
// API Functions
// ============================================

interface BriefingResponse {
  success: boolean;
  briefing?: string;
  actionsSummary?: string;
  userNarration?: string;
  llmAnalysis?: string;
  discrepancies?: string[];
  suggestedQuestions?: string[];
  error?: string;
}

async function fetchAgentBriefing(taskId: string): Promise<BriefingResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/agent-briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}), // Fastify requires a body with Content-Type: application/json
    });
    
    if (!response.ok) {
      console.error('[Popup] Briefing request failed:', response.statusText);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('[Popup] Failed to fetch briefing:', error);
    return null;
  }
}

// ============================================
// DOM Elements
// ============================================

const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const btnText = recordBtn.querySelector('.btn-text') as HTMLSpanElement;
const recordIcon = recordBtn.querySelector('.record-icon') as HTMLSpanElement;
const stopIcon = recordBtn.querySelector('.stop-icon') as HTMLSpanElement;
const statusBadge = document.getElementById('status-badge') as HTMLDivElement;
const statusText = statusBadge.querySelector('.status-text') as HTMLSpanElement;
const actionCount = document.getElementById('action-count') as HTMLSpanElement;
const duration = document.getElementById('duration') as HTMLSpanElement;
const resultSection = document.getElementById('result-section') as HTMLElement;
const resultContent = document.getElementById('result-content') as HTMLDivElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const processingSection = document.getElementById('processing-section') as HTMLElement;
const errorSection = document.getElementById('error-section') as HTMLElement;
const errorMessage = document.getElementById('error-message') as HTMLParagraphElement;
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement;
const popoutBtn = document.getElementById('popout-btn') as HTMLButtonElement;

// ============================================
// State
// ============================================

let isRecording = false;
let startTime = 0;
let durationInterval: ReturnType<typeof setInterval> | null = null;
let currentMarkdown = '';

// ============================================
// UI Updates
// ============================================

function updateUI(state: 'ready' | 'recording' | 'processing' | 'completed' | 'error'): void {
  // Reset all states
  statusBadge.className = 'status-badge';
  recordBtn.className = 'record-btn';
  resultSection.classList.add('hidden');
  processingSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  recordBtn.disabled = false;

  switch (state) {
    case 'ready':
      statusText.textContent = 'Ready';
      btnText.textContent = 'Start Recording';
      recordIcon.classList.remove('hidden');
      stopIcon.classList.add('hidden');
      break;

    case 'recording':
      statusBadge.classList.add('recording');
      statusText.textContent = 'Recording';
      btnText.textContent = 'Stop Recording';
      recordBtn.classList.add('recording');
      recordIcon.classList.add('hidden');
      stopIcon.classList.remove('hidden');
      break;

    case 'processing':
      statusBadge.classList.add('processing');
      statusText.textContent = 'Processing';
      processingSection.classList.remove('hidden');
      recordBtn.disabled = true;
      break;

    case 'completed':
      statusBadge.classList.add('completed');
      statusText.textContent = 'Completed';
      resultSection.classList.remove('hidden');
      btnText.textContent = 'New Recording';
      recordIcon.classList.remove('hidden');
      stopIcon.classList.add('hidden');
      break;

    case 'error':
      statusText.textContent = 'Error';
      errorSection.classList.remove('hidden');
      btnText.textContent = 'Try Again';
      recordIcon.classList.remove('hidden');
      stopIcon.classList.add('hidden');
      break;
  }
}

function updateActionCount(count: number): void {
  actionCount.textContent = count.toString();
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function startDurationTimer(fromTime?: number): void {
  startTime = fromTime || Date.now();
  // Update immediately
  const elapsed = Date.now() - startTime;
  duration.textContent = formatDuration(elapsed);
  // Then update every second
  durationInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    duration.textContent = formatDuration(elapsed);
  }, 1000);
}

function stopDurationTimer(): void {
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }
}

function displayMarkdown(markdown: string): void {
  currentMarkdown = markdown;
  // Simple markdown rendering - just display as preformatted text
  // In production, use a proper markdown renderer
  resultContent.textContent = markdown;
}

function showError(message: string): void {
  errorMessage.textContent = message;
  updateUI('error');
}

// ============================================
// Recording Control
// ============================================

async function startRecording(): Promise<void> {
  console.log('[Popup] Starting recording...');
  try {
    // Start audio recording first (request microphone permission)
    const audioStarted = await audioRecorder.start((chunk) => {
      // Send audio chunks to background
      console.log('[Popup] Audio chunk captured, size:', chunk.data.size);
      // Convert blob to base64 and send to background
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        chrome.runtime.sendMessage({ 
          type: 'AUDIO_CHUNK', 
          payload: { 
            data: base64,
            timestamp: chunk.timestamp,
            duration: chunk.duration
          }
        }).catch(console.error);
      };
      reader.readAsDataURL(chunk.data);
    });

    if (!audioStarted) {
      console.warn('[Popup] Audio recording not started (permission denied or unsupported)');
      // Continue without audio - it's optional
    }

    // Send message to background to start recording DOM actions
    const response = await chrome.runtime.sendMessage({ type: 'START_RECORDING' });
    console.log('[Popup] Start recording response:', response);
    
    if (response && response.success) {
      isRecording = true;
      updateUI('recording');
      updateActionCount(0);
      duration.textContent = '0:00';
      startDurationTimer();
      console.log('[Popup] UI updated to recording state');
    } else {
      // Stop audio if DOM recording failed
      await audioRecorder.stop();
      const errorMsg = response?.error || 'Failed to start recording';
      console.error('[Popup] Start recording failed:', errorMsg);
      showError(errorMsg);
    }
  } catch (error) {
    console.error('[Popup] Start recording error:', error);
    await audioRecorder.stop();
    showError('Failed to communicate with extension');
  }
}

async function stopRecording(): Promise<void> {
  try {
    stopDurationTimer();
    updateUI('processing');

    // Stop audio recording and get the complete audio blob
    const audioBlob = await audioRecorder.stop();
    console.log('[Popup] Audio recording stopped, size:', audioBlob?.size || 0);

    // If we have audio, send it to the background
    if (audioBlob && audioBlob.size > 0) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result as string;
        await chrome.runtime.sendMessage({
          type: 'AUDIO_COMPLETE',
          payload: { data: base64, size: audioBlob.size }
        }).catch(console.error);
      };
      reader.readAsDataURL(audioBlob);
    }

    // Send message to background to stop recording and generate output
    const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    
    if (response.success) {
      isRecording = false;
      // Wait for generation complete message
    } else {
      showError(response.error || 'Failed to stop recording');
    }
  } catch (error) {
    showError('Failed to communicate with extension');
    console.error('[Popup] Stop recording error:', error);
  }
}

function resetRecording(): void {
  isRecording = false;
  updateUI('ready');
  updateActionCount(0);
  duration.textContent = '0:00';
  currentMarkdown = '';
}

// ============================================
// Clipboard
// ============================================

async function copyToClipboard(): Promise<void> {
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    
    // Visual feedback
    copyBtn.classList.add('copied');
    const originalText = copyBtn.querySelector('span')?.textContent;
    const textSpan = copyBtn.querySelector('span');
    if (textSpan) textSpan.textContent = 'Copied!';
    
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      if (textSpan) textSpan.textContent = originalText || 'Copy';
    }, 2000);
  } catch (error) {
    console.error('[Task Recorder] Copy to clipboard error:', error);
  }
}

// ============================================
// Event Listeners
// ============================================

recordBtn.addEventListener('click', () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

copyBtn.addEventListener('click', copyToClipboard);

retryBtn.addEventListener('click', resetRecording);

// Open in separate window that won't close on click outside
popoutBtn.addEventListener('click', async () => {
  const popupUrl = chrome.runtime.getURL('popup.html');
  await chrome.windows.create({
    url: popupUrl,
    type: 'popup',
    width: 400,
    height: 600,
    focused: true,
  });
  // Close the current popup
  window.close();
});

// Listen for messages from background
chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  switch (message.type) {
    case 'RECORDING_STATUS': {
      const payload = message.payload as RecordingStatusPayload;
      if (payload.isRecording) {
        updateUI('recording');
        updateActionCount(payload.actionCount);
      }
      break;
    }

    case 'ACTION_CAPTURED': {
      const payload = message.payload as { count: number };
      updateActionCount(payload.count);
      break;
    }

    case 'GENERATION_COMPLETE': {
      const payload = message.payload as GenerationCompletePayload & { taskId?: string };
      const finalMarkdown = payload.markdown;
      const taskId = payload.taskId;
      
      // Check if we should show the clarification agent
      // (Skip if no meaningful content was recorded)
      const hasContent = !finalMarkdown.includes('No actions were recorded');
      
      if (hasContent && AGENT_ID && taskId) {
        // First, get the briefing from the backend
        fetchAgentBriefing(taskId).then(briefing => {
          // Show clarification agent modal with full context
          showAgentModal(
            AGENT_ID,
            {
              taskSummary: briefing?.briefing || 'Tarea recién grabada',
              actionsSummary: briefing?.actionsSummary || '',
              userNarration: briefing?.userNarration || '',
              llmAnalysis: briefing?.llmAnalysis || '',
              discrepancies: briefing?.discrepancies || [],
              suggestedQuestions: briefing?.suggestedQuestions || [],
              actionCount: parseInt(actionCount.textContent || '0'),
              duration: Date.now() - startTime,
            },
            (didConverse) => {
              console.log('[Popup] Agent modal closed, didConverse:', didConverse);
              
              if (didConverse) {
                const enrichedMarkdown = `${finalMarkdown}

---

> 💬 *El usuario habló con Maisa para aclarar detalles de esta tarea.*
`;
                displayMarkdown(enrichedMarkdown);
              } else {
                displayMarkdown(finalMarkdown);
              }
              updateUI('completed');
            }
          );
        }).catch(error => {
          console.error('[Popup] Failed to get briefing:', error);
          // Show agent anyway with minimal context
          showAgentModal(
            AGENT_ID,
            {
              taskSummary: 'Tarea recién grabada',
              actionsSummary: '',
              userNarration: '',
              llmAnalysis: '',
              discrepancies: [],
              suggestedQuestions: [],
              actionCount: parseInt(actionCount.textContent || '0'),
              duration: Date.now() - startTime,
            },
            (didConverse) => {
              displayMarkdown(finalMarkdown);
              updateUI('completed');
            }
          );
        });
      } else {
        // No agent, just show results
        displayMarkdown(finalMarkdown);
        updateUI('completed');
      }
      break;
    }

    case 'ERROR': {
      const payload = message.payload as ErrorPayload;
      showError(payload.message);
      break;
    }
  }
});

// ============================================
// Initialization
// ============================================

async function initialize(): Promise<void> {
  console.log('[Popup] Initializing...');
  try {
    // Check current recording status
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    console.log('[Popup] Current status:', response);
    
    if (response && response.isRecording) {
      isRecording = true;
      updateUI('recording');
      updateActionCount(response.actionCount || 0);
      // Resume duration timer from stored start time
      if (response.startTime) {
        startDurationTimer(response.startTime);
      }
      console.log('[Popup] Resumed recording state');
    } else if (response && response.lastMarkdown) {
      currentMarkdown = response.lastMarkdown;
      displayMarkdown(currentMarkdown);
      updateUI('completed');
      console.log('[Popup] Showing last markdown');
    } else {
      updateUI('ready');
      console.log('[Popup] Ready state');
    }
  } catch (error) {
    console.error('[Popup] Initialize error:', error);
    updateUI('ready');
  }
}

// Initialize on load
initialize();

