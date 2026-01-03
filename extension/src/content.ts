// ============================================
// Task Recorder - Content Script
// Captures DOM events and sends to background
// ============================================

import type { Action, ActionType, ActionTarget, ActionMetadata, ExtensionMessage } from './types.js';

// State
let isRecording = false;
let lastActionTimestamp = 0;

// ============================================
// Utility Functions
// ============================================

function getSelector(element: Element): string {
  // Try data-testid first
  const testId = element.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;

  // Try id
  if (element.id) return `#${element.id}`;

  // Try unique class combination
  if (element.classList.length > 0) {
    const classes = Array.from(element.classList).slice(0, 2).join('.');
    return `${element.tagName.toLowerCase()}.${classes}`;
  }

  // Fallback to tag + nth-child
  const parent = element.parentElement;
  if (parent) {
    const index = Array.from(parent.children).indexOf(element) + 1;
    return `${element.tagName.toLowerCase()}:nth-child(${index})`;
  }

  return element.tagName.toLowerCase();
}

function getVisibleText(element: Element): string {
  const text = element.textContent?.trim() || '';
  // Limit to first 100 chars
  return text.slice(0, 100);
}

function getElementRole(element: Element): string | undefined {
  const role = element.getAttribute('role');
  if (role) return role;

  const tagRoles: Record<string, string> = {
    'A': 'link',
    'BUTTON': 'button',
    'INPUT': 'textbox',
    'SELECT': 'combobox',
    'TEXTAREA': 'textbox',
    'IMG': 'img',
    'NAV': 'navigation',
    'MAIN': 'main',
    'ARTICLE': 'article',
  };

  return tagRoles[element.tagName];
}

function getPageContext(): Pick<ActionMetadata, 'pageTitle' | 'h1'> {
  const h1 = document.querySelector('h1');
  return {
    pageTitle: document.title,
    h1: h1?.textContent?.trim().slice(0, 100),
  };
}

function calculateIdleTime(): number {
  if (lastActionTimestamp === 0) return 0;
  return Date.now() - lastActionTimestamp;
}

function buildAction(type: ActionType, target: ActionTarget): Action {
  const idleTimeBefore = calculateIdleTime();
  lastActionTimestamp = Date.now();

  return {
    type,
    timestamp: lastActionTimestamp,
    url: window.location.href,
    target,
    metadata: {
      ...getPageContext(),
      idleTimeBefore,
    },
  };
}

function sendActionToBackground(action: Action): void {
  // Check if extension context is still valid
  if (!chrome.runtime?.id) {
    console.warn('[Task Recorder] Extension context invalidated, stopping recording');
    stopRecording();
    return;
  }
  
  chrome.runtime.sendMessage({
    type: 'ACTION_CAPTURED',
    payload: action,
  }).catch((error) => {
    // If context was invalidated, stop recording silently
    if (error?.message?.includes('Extension context invalidated')) {
      console.warn('[Task Recorder] Extension reloaded, stopping recording');
      stopRecording();
      return;
    }
    console.error('[Task Recorder] Failed to send action:', error);
  });
}

// ============================================
// Event Handlers
// ============================================

function handleClick(event: MouseEvent): void {
  if (!isRecording) {
    console.log('[Task Recorder] Click ignored - not recording');
    return;
  }

  const target = event.target as Element;
  if (!target) return;

  const action = buildAction('click', {
    selector: getSelector(target),
    text: getVisibleText(target),
    role: getElementRole(target),
  });

  console.log('[Task Recorder] Captured click:', action.target.text);
  sendActionToBackground(action);
}

function handleInput(event: Event): void {
  if (!isRecording) return;

  const target = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!target) return;

  // We don't capture the actual value for privacy
  // Just signal that input occurred
  const action = buildAction('input', {
    selector: getSelector(target),
    text: `[input: ${target.type || 'text'}]`,
    role: getElementRole(target),
  });

  sendActionToBackground(action);
}

function handleCopy(): void {
  if (!isRecording) return;

  // Get selected text context
  const selection = window.getSelection();
  const selectedText = selection?.toString().trim().slice(0, 50) || '';

  const action = buildAction('copy', {
    selector: 'document',
    text: selectedText ? `[copied: "${selectedText}..."]` : '[copied]',
    role: undefined,
  });

  sendActionToBackground(action);
}

function handleNavigation(): void {
  if (!isRecording) return;

  const action = buildAction('navigation', {
    selector: 'document',
    text: document.title,
    role: undefined,
  });

  sendActionToBackground(action);
}

// Debounced scroll handler
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
function handleScroll(): void {
  if (!isRecording) return;

  // Debounce scroll events - only capture after scrolling stops
  if (scrollTimeout) clearTimeout(scrollTimeout);
  
  scrollTimeout = setTimeout(() => {
    const scrollPosition = window.scrollY;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const scrollPercent = Math.round((scrollPosition / maxScroll) * 100);

    const action = buildAction('scroll', {
      selector: 'window',
      text: `[scrolled to ${scrollPercent}%]`,
      role: undefined,
    });

    sendActionToBackground(action);
  }, 500);
}

// ============================================
// Recording Control
// ============================================

function startRecording(): void {
  if (isRecording) {
    console.log('[Task Recorder] Already recording');
    return;
  }
  
  isRecording = true;
  lastActionTimestamp = Date.now();

  // Add event listeners
  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('copy', handleCopy, true);
  window.addEventListener('scroll', handleScroll, { passive: true });

  // Capture initial navigation
  handleNavigation();

  console.log('[Task Recorder] Recording started on:', window.location.href);
}

function stopRecording(): void {
  isRecording = false;

  // Remove event listeners
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('copy', handleCopy, true);
  window.removeEventListener('scroll', handleScroll);

  if (scrollTimeout) {
    clearTimeout(scrollTimeout);
    scrollTimeout = null;
  }

  console.log('[Task Recorder] Recording stopped');
}

// ============================================
// Message Handling
// ============================================

// Only add listener if runtime is available
if (chrome.runtime?.id) {
  chrome.runtime.onMessage.addListener((
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    // Check if message is valid
    if (!message || typeof message.type !== 'string') {
      sendResponse({ success: false, error: 'Invalid message' });
      return true;
    }
    
    switch (message.type) {
      case 'START_RECORDING':
        startRecording();
        sendResponse({ success: true });
        break;

      case 'STOP_RECORDING':
        stopRecording();
        sendResponse({ success: true });
        break;

      case 'RECORDING_STATUS':
        sendResponse({ isRecording });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }

    return true; // Keep channel open for async response
  });
} else {
  console.warn('[Task Recorder] Extension context not available');
}

// Handle page unload - notify background of navigation
window.addEventListener('beforeunload', () => {
  if (isRecording) {
    handleNavigation();
  }
});

// Handle popstate (back/forward navigation)
window.addEventListener('popstate', () => {
  if (isRecording) {
    handleNavigation();
  }
});

console.log('[Task Recorder] Content script loaded');

