// ============================================
// Task Recorder - Agent Widget
// Attio-inspired clean dialog
// ============================================

export interface AgentContext {
  taskSummary: string;
  actionsSummary: string;
  userNarration: string;
  llmAnalysis: string;
  discrepancies: string[];
  suggestedQuestions: string[];
  actionCount: number;
  duration: number;
}

const AGENT_ID = 'agent_4801ke0jpqkdf8pa17y612q7vhgq';
const AGENT_PAGE_URL = 'http://localhost:3000/agent.html';

function createConfirmModal(): HTMLElement {
  const container = document.createElement('div');
  container.id = 'task-recorder-agent-modal';
  container.innerHTML = `
    <div class="tr-overlay">
      <div class="tr-dialog">
        <div class="tr-dialog-header">
          <div class="tr-dialog-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" x2="12" y1="19" y2="22"/>
            </svg>
          </div>
          <button class="tr-dialog-close" title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        
        <div class="tr-dialog-content">
          <h2>Review with Maisa</h2>
          <p>Maisa will review the generated documentation and ask clarifying questions to ensure accuracy.</p>
        </div>
        
        <div class="tr-dialog-footer">
          <button class="tr-btn tr-btn-secondary tr-skip">Skip</button>
          <button class="tr-btn tr-btn-primary tr-start">Start conversation</button>
        </div>
      </div>
    </div>
  `;

  const styles = document.createElement('style');
  styles.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
    
    .tr-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      animation: tr-fade 0.15s ease;
    }

    @keyframes tr-fade {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    .tr-dialog {
      background: #FFFFFF;
      border-radius: 12px;
      width: 340px;
      max-width: calc(100vw - 32px);
      box-shadow: 
        0 16px 40px rgba(0, 0, 0, 0.12),
        0 0 0 1px rgba(0, 0, 0, 0.04);
      animation: tr-slide 0.2s cubic-bezier(0.25, 0.1, 0.25, 1);
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    @keyframes tr-slide {
      from { transform: translateY(8px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }

    .tr-dialog-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 16px 0;
    }

    .tr-dialog-icon {
      width: 36px;
      height: 36px;
      background: rgba(124, 58, 237, 0.1);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #7C3AED;
    }

    .tr-dialog-close {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: #A1A1AA;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tr-dialog-close:hover {
      background: #F4F4F5;
      color: #71717A;
    }

    .tr-dialog-content {
      padding: 16px;
    }

    .tr-dialog-content h2 {
      font-size: 15px;
      font-weight: 600;
      color: #09090B;
      margin: 0 0 6px;
      letter-spacing: -0.02em;
    }

    .tr-dialog-content p {
      font-size: 13px;
      color: #71717A;
      line-height: 1.5;
      margin: 0;
    }

    .tr-dialog-footer {
      display: flex;
      gap: 8px;
      padding: 12px 16px 16px;
    }

    .tr-btn {
      flex: 1;
      padding: 10px 16px;
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tr-btn-secondary {
      background: #FFFFFF;
      border: 1px solid #E4E4E7;
      color: #3F3F46;
    }

    .tr-btn-secondary:hover {
      background: #FAFAFA;
      border-color: #D4D4D8;
    }

    .tr-btn-primary {
      background: #7C3AED;
      border: none;
      color: white;
    }

    .tr-btn-primary:hover {
      background: #6D28D9;
    }
  `;

  container.appendChild(styles);
  return container;
}

export async function showAgentModal(
  agentId: string,
  context: AgentContext | undefined,
  onComplete: (didConverse: boolean) => void
): Promise<void> {
  const modal = createConfirmModal();
  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('.tr-dialog-close');
  const skipBtn = modal.querySelector('.tr-skip');
  const startBtn = modal.querySelector('.tr-start');

  let taskId: string | null = null;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    taskId = response?.taskId || null;
  } catch (e) {
    console.error('[Agent] Failed to get taskId:', e);
  }

  const handleSkip = () => {
    modal.remove();
    onComplete(false);
  };

  closeBtn?.addEventListener('click', handleSkip);
  skipBtn?.addEventListener('click', handleSkip);

  startBtn?.addEventListener('click', () => {
    const url = new URL(AGENT_PAGE_URL);
    url.searchParams.set('agentId', agentId || AGENT_ID);
    if (taskId) {
      url.searchParams.set('taskId', taskId);
    }
    window.open(url.toString(), '_blank');
    modal.remove();
    onComplete(true);
  });
}
