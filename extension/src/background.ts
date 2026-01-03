// ============================================
// Task Recorder - Background Service Worker
// Manages state and communicates with backend
// ============================================

import type { Action, ExtensionMessage, RecordingStatusPayload, GenerationCompletePayload, ErrorPayload } from './types.js';

// ============================================
// Configuration
// ============================================

const API_BASE_URL = 'https://task-recorder-tawny.vercel.app';
const BATCH_INTERVAL_MS = 5000; // Send actions every 5 seconds

// ============================================
// State
// ============================================

interface RecordingState {
  isRecording: boolean;
  taskId: string | null;
  actions: Action[];
  actionCount: number; // Total actions captured (persists after flush)
  startTime: number | null;
  lastMarkdown: string | null;
  // Audio state
  audioChunks: string[]; // Base64 encoded audio chunks
  completeAudio: string | null; // Complete audio blob as base64
}

let state: RecordingState = {
  isRecording: false,
  taskId: null,
  actions: [],
  actionCount: 0,
  startTime: null,
  lastMarkdown: null,
  audioChunks: [],
  completeAudio: null,
};

let batchInterval: ReturnType<typeof setInterval> | null = null;

// ============================================
// API Functions
// ============================================

async function createTask(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}), // Send empty object as body
  });
  
  if (!response.ok) {
    throw new Error(`Failed to create task: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.taskId;
}

async function sendActions(taskId: string, actions: Action[]): Promise<void> {
  if (actions.length === 0) return;
  
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actions }),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to send actions: ${response.statusText}`);
  }
}

async function sendAudio(taskId: string, audioBase64: string): Promise<void> {
  console.log('[Background] Sending audio to backend...');
  
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: audioBase64 }),
  });
  
  if (!response.ok) {
    console.warn(`[Background] Failed to send audio: ${response.statusText}`);
    // Don't throw - audio is optional
  } else {
    console.log('[Background] Audio sent successfully');
  }
}

async function stopTask(taskId: string, audioBase64?: string | null): Promise<string> {
  // If we have audio, send it first
  if (audioBase64) {
    try {
      await sendAudio(taskId, audioBase64);
    } catch (error) {
      console.warn('[Background] Audio send failed, continuing without:', error);
    }
  }

  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}/stop`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to stop task: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.output?.rawMarkdown || '';
}

// ============================================
// Recording Control
// ============================================

async function startRecording(): Promise<{ success: boolean; error?: string }> {
  console.log('[Background] startRecording called');
  try {
    // Create task on backend
    console.log('[Background] Creating task on backend...');
    const taskId = await createTask();
    console.log('[Background] Task created:', taskId);
    
    state = {
      isRecording: true,
      taskId,
      actions: [],
      actionCount: 0,
      startTime: Date.now(),
      lastMarkdown: null,
      audioChunks: [],
      completeAudio: null,
    };
    
    // Start batch interval
    batchInterval = setInterval(flushActions, BATCH_INTERVAL_MS);
    
    // Inject content script and notify all tabs to start recording
    const tabs = await chrome.tabs.query({});
    console.log('[Background] Injecting into', tabs.length, 'tabs');
    for (const tab of tabs) {
      if (!tab.id || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
        continue;
      }
      
      try {
        // Try to send message first (content script might already be loaded)
        await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
      } catch {
        // Content script not loaded, inject it
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['src/content.js'],
          });
          // Wait a bit for script to initialize
          await new Promise(resolve => setTimeout(resolve, 100));
          await chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
        } catch (err) {
          console.warn(`[Background] Could not inject into tab ${tab.id}:`, err);
        }
      }
    }
    
    console.log('[Background] Recording started successfully, returning { success: true }');
    return { success: true };
  } catch (error) {
    console.error('[Background] Failed to start recording:', error);
    return { success: false, error: (error as Error).message };
  }
}

async function stopRecording(): Promise<{ success: boolean; error?: string }> {
  try {
    if (!state.taskId) {
      throw new Error('No active recording');
    }
    
    // Stop batch interval
    if (batchInterval) {
      clearInterval(batchInterval);
      batchInterval = null;
    }
    
    // Notify all content scripts to stop recording
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
        } catch {
          // Content script might not be loaded
        }
      }
    }
    
    // Flush remaining actions
    await flushActions();
    
    // Stop task and get generated markdown (include audio if available)
    const markdown = await stopTask(state.taskId, state.completeAudio);
    const taskId = state.taskId;
    
    state.isRecording = false;
    state.lastMarkdown = markdown;
    // Clear audio state
    state.audioChunks = [];
    state.completeAudio = null;
    
    // Notify popup of completion
    chrome.runtime.sendMessage({
      type: 'GENERATION_COMPLETE',
      payload: {
        markdown,
        taskId,
      },
    }).catch(() => {
      // Popup might be closed - that's OK
    });
    
    // Open the agent page automatically (works even if popup is closed)
    const agentUrl = `${API_BASE_URL}/agent.html?taskId=${taskId}&agentId=agent_4801ke0jpqkdf8pa17y612q7vhgq`;
    console.log('[Task Recorder] Opening agent page:', agentUrl);
    chrome.tabs.create({ url: agentUrl });
    
    console.log('[Task Recorder] Recording stopped, markdown generated');
    return { success: true };
  } catch (error) {
    console.error('[Task Recorder] Failed to stop recording:', error);
    
    // Notify popup of error
    chrome.runtime.sendMessage({
      type: 'ERROR',
      payload: { message: (error as Error).message },
    }).catch(() => {});
    
    state.isRecording = false;
    return { success: false, error: (error as Error).message };
  }
}

async function flushActions(): Promise<void> {
  if (!state.taskId || state.actions.length === 0) return;
  
  const actionsToSend = [...state.actions];
  state.actions = [];
  
  try {
    await sendActions(state.taskId, actionsToSend);
    console.log(`[Task Recorder] Flushed ${actionsToSend.length} actions`);
  } catch (error) {
    console.error('[Task Recorder] Failed to flush actions:', error);
    // Re-add actions to queue
    state.actions = [...actionsToSend, ...state.actions];
  }
}

// ============================================
// Message Handling
// ============================================

chrome.runtime.onMessage.addListener((
  message: ExtensionMessage,
  _sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => {
  const handleMessage = async () => {
    switch (message.type) {
      case 'START_RECORDING':
        return await startRecording();
      
      case 'STOP_RECORDING':
        return await stopRecording();
      
      case 'GET_STATUS':
        return {
          isRecording: state.isRecording,
          taskId: state.taskId,
          actionCount: state.actionCount,
          startTime: state.startTime,
          lastMarkdown: state.lastMarkdown,
        };
      
      case 'ACTION_CAPTURED': {
        if (!state.isRecording) return { success: false };
        
        const action = message.payload as Action;
        state.actions.push(action);
        state.actionCount++; // Increment total counter
        
        // Notify popup of new action with current count
        chrome.runtime.sendMessage({
          type: 'ACTION_CAPTURED',
          payload: { action, count: state.actionCount },
        }).catch(() => {});
        
        return { success: true, count: state.actionCount };
      }

      case 'AUDIO_CHUNK': {
        if (!state.isRecording) return { success: false };
        
        const chunk = message.payload as { data: string; timestamp: number; duration: number };
        state.audioChunks.push(chunk.data);
        console.log('[Background] Audio chunk received, total chunks:', state.audioChunks.length);
        
        return { success: true };
      }

      case 'AUDIO_COMPLETE': {
        const audio = message.payload as { data: string; size: number };
        state.completeAudio = audio.data;
        console.log('[Background] Complete audio received, size:', audio.size);
        
        return { success: true };
      }
      
      default:
        return { success: false, error: 'Unknown message type' };
    }
  };
  
  handleMessage()
    .then(sendResponse)
    .catch((error) => sendResponse({ success: false, error: error.message }));
  
  return true; // Keep channel open for async response
});

// ============================================
// Tab Events
// ============================================

// Inject content script into new tabs while recording
chrome.tabs.onUpdated.addListener(async (
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo
) => {
  if (state.isRecording && changeInfo.status === 'complete') {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
    } catch {
      // Content script might not be loaded yet, try to inject it
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['src/content.js'],
        });
        await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING' });
      } catch {
        // Tab might not support scripting
      }
    }
  }
});

// Handle extension install/update
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Task Recorder] Extension installed/updated');
});

console.log('[Task Recorder] Background service worker started');

