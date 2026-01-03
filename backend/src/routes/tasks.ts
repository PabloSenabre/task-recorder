// ============================================
// Task Recorder Backend - Task Routes
// ============================================

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  TaskSession,
  Action,
  AddActionsRequest,
  CreateTaskResponse,
  AddActionsResponse,
  StopTaskResponse,
  GetTaskResponse,
} from '../types.js';
import { generateDocumentation } from '../services/generator.js';
import { transcribeAudio, isConfigured as isElevenLabsConfigured } from '../services/elevenlabs.js';
import { getTask, setTask, deleteTask, listTasks } from '../store/index.js';

// Get directory path for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RESULTS_DIR = join(__dirname, '../../results');

// ============================================
// Route Handlers
// ============================================

interface TaskParams {
  id: string;
}

export async function taskRoutes(fastify: FastifyInstance): Promise<void> {
  
  // POST /tasks - Create a new task session
  fastify.post('/', async (
    _request: FastifyRequest,
    reply: FastifyReply
  ): Promise<CreateTaskResponse> => {
    // Accept empty body for task creation
    const taskId = uuidv4();
    
    const task: TaskSession = {
      id: taskId,
      status: 'recording',
      startTs: Date.now(),
      actions: [],
    };
    
    await setTask(taskId, task);
    
    fastify.log.info({ taskId }, 'Task created');
    
    reply.status(201);
    return {
      taskId,
      status: task.status,
    };
  });

  // POST /tasks/:id/actions - Add actions to a task
  fastify.post<{
    Params: TaskParams;
    Body: AddActionsRequest;
  }>('/:id/actions', async (
    request,
    reply
  ): Promise<AddActionsResponse> => {
    const { id } = request.params;
    const { actions } = request.body;
    
    const task = await getTask(id);
    
    if (!task) {
      reply.status(404);
      throw new Error(`Task not found: ${id}`);
    }
    
    if (task.status !== 'recording') {
      reply.status(400);
      throw new Error(`Task is not in recording state: ${task.status}`);
    }
    
    // Validate and add actions
    const validActions = actions.filter((action: Action) => 
      action.type && action.timestamp && action.url
    );
    
    task.actions.push(...validActions);
    await setTask(id, task);
    
    fastify.log.info(
      { taskId: id, received: validActions.length, total: task.actions.length },
      'Actions added'
    );
    
    return {
      received: validActions.length,
      total: task.actions.length,
    };
  });

  // POST /tasks/:id/audio - Add audio narration to a task
  fastify.post<{
    Params: TaskParams;
    Body: { audio: string }; // Base64 encoded audio
  }>('/:id/audio', async (
    request,
    reply
  ): Promise<{ transcription?: string; error?: string }> => {
    const { id } = request.params;
    const { audio } = request.body;
    
    const task = await getTask(id);
    
    if (!task) {
      reply.status(404);
      throw new Error(`Task not found: ${id}`);
    }
    
    if (!audio) {
      reply.status(400);
      throw new Error('No audio data provided');
    }

    // Check if Eleven Labs is configured
    if (!isElevenLabsConfigured()) {
      fastify.log.warn({ taskId: id }, 'Eleven Labs not configured, skipping transcription');
      return { error: 'Eleven Labs not configured' };
    }

    try {
      // Extract base64 data (remove data URL prefix if present)
      const base64Data = audio.replace(/^data:audio\/\w+;base64,/, '');
      const audioBuffer = Buffer.from(base64Data, 'base64');
      
      fastify.log.info({ taskId: id, audioSize: audioBuffer.length }, 'Transcribing audio');
      
      // Transcribe using Eleven Labs
      const result = await transcribeAudio(audioBuffer, 'es');
      
      // Store transcription in task
      task.narration = result.text;
      task.narrationSegments = result.segments;
      await setTask(id, task);
      
      fastify.log.info(
        { taskId: id, transcriptionLength: result.text.length },
        'Audio transcribed successfully'
      );
      
      return { transcription: result.text };
    } catch (error) {
      fastify.log.error({ taskId: id, error: (error as Error).message }, 'Transcription failed');
      return { error: (error as Error).message };
    }
  });

  // POST /tasks/:id/stop - Stop recording and generate documentation
  fastify.post<{
    Params: TaskParams;
  }>('/:id/stop', async (
    request,
    reply
  ): Promise<StopTaskResponse> => {
    const { id } = request.params;
    
    const task = await getTask(id);
    
    if (!task) {
      reply.status(404);
      throw new Error(`Task not found: ${id}`);
    }
    
    if (task.status !== 'recording') {
      reply.status(400);
      throw new Error(`Task is not in recording state: ${task.status}`);
    }
    
    // Update status to processing
    task.status = 'processing';
    task.endTs = Date.now();
    await setTask(id, task);
    
    fastify.log.info(
      { taskId: id, actionCount: task.actions.length },
      'Processing task'
    );
    
    try {
      // Generate documentation using the LLM pipeline
      const result = await generateDocumentation(task);
      
      // Update task with results
      task.status = 'completed';
      task.chunks = result.chunks;
      task.metrics = result.metrics;
      task.knowHowExtraction = result.knowHow;
      task.output = result.output;
      await setTask(id, task);
      
      // Save result to file (only works in local dev, not serverless)
      await saveResult(id, task.output.rawMarkdown, 'initial');
      
      fastify.log.info({ taskId: id }, 'Task completed successfully');
      
      return {
        status: task.status,
        output: task.output,
      };
    } catch (error) {
      task.status = 'error';
      task.error = (error as Error).message;
      await setTask(id, task);
      
      fastify.log.error({ taskId: id, error: task.error }, 'Task processing failed');
      
      reply.status(500);
      return {
        status: task.status,
        error: task.error,
      };
    }
  });

  // GET /tasks/:id - Get task details
  fastify.get<{
    Params: TaskParams;
  }>('/:id', async (
    request,
    reply
  ): Promise<GetTaskResponse> => {
    const { id } = request.params;
    
    const task = await getTask(id);
    
    if (!task) {
      reply.status(404);
      throw new Error(`Task not found: ${id}`);
    }
    
    return { task };
  });

  // DELETE /tasks/:id - Delete a task (cleanup)
  fastify.delete<{
    Params: TaskParams;
  }>('/:id', async (
    request,
    reply
  ): Promise<{ deleted: boolean }> => {
    const { id } = request.params;
    
    const deleted = await deleteTask(id);
    
    if (!deleted) {
      reply.status(404);
      throw new Error(`Task not found: ${id}`);
    }
    
    fastify.log.info({ taskId: id }, 'Task deleted');
    
    return { deleted: true };
  });

  // GET /tasks - List all tasks (for debugging)
  fastify.get('/', async (): Promise<{ tasks: TaskSession[] }> => {
    const allTasks = await listTasks();
    return {
      tasks: allTasks.map(task => ({
        ...task,
        // Don't include full actions in list view
        actions: [],
        actionCount: task.actions.length,
      } as TaskSession)),
    };
  });

  // POST /tasks/:id/agent-briefing - Generate and inject briefing for the conversational agent
  fastify.post<{
    Params: TaskParams;
  }>('/:id/agent-briefing', async (
    request,
    reply
  ): Promise<{ 
    success: boolean; 
    briefing?: string;
    actionsSummary?: string;
    userNarration?: string;
    llmAnalysis?: string;
    discrepancies?: string[];
    suggestedQuestions?: string[];
    error?: string;
  }> => {
    const { id } = request.params;
    
    const task = await getTask(id);
    
    if (!task) {
      reply.status(404);
      throw new Error(`Task not found: ${id}`);
    }
    
    if (task.status !== 'completed') {
      reply.status(400);
      throw new Error(`Task is not completed: ${task.status}`);
    }

    try {
      // Generate a summary of actions for the agent
      const actionsSummary = generateActionsSummary(task.actions);
      
      // Detect potential discrepancies or points to clarify
      const discrepancies = detectDiscrepancies(task);
      
      // Generate suggested questions
      const suggestedQuestions = generateSuggestedQuestions(task, discrepancies);
      
      // Get the LLM analysis (what GPT-4o generated)
      const llmAnalysis = buildLLMAnalysisSummary(task);
      
      // Build the briefing text (now includes LLM analysis)
      const briefing = buildAgentBriefing({
        actionsSummary,
        narration: task.narration || '',
        discrepancies,
        suggestedQuestions,
        llmAnalysis,
        duration: (task.endTs || Date.now()) - task.startTs,
        actionCount: task.actions.length,
      });
      
      fastify.log.info(
        { taskId: id, briefingLength: briefing.length, questionsCount: suggestedQuestions.length },
        'Agent briefing generated'
      );
      
      return {
        success: true,
        briefing,
        actionsSummary,
        userNarration: task.narration || '',
        llmAnalysis,
        discrepancies: discrepancies.map(d => d.description),
        suggestedQuestions,
      };
    } catch (error) {
      fastify.log.error({ taskId: id, error: (error as Error).message }, 'Failed to generate agent briefing');
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });

  // POST /tasks/:id/clarification - Process clarification conversation and regenerate docs
  fastify.post<{
    Params: TaskParams;
    Body: { transcript: string };
  }>('/:id/clarification', async (
    request,
    reply
  ): Promise<{ 
    success: boolean; 
    updatedMarkdown?: string;
    error?: string;
  }> => {
    const { id } = request.params;
    const { transcript } = request.body;
    
    const task = await getTask(id);
    
    if (!task) {
      reply.status(404);
      throw new Error(`Task not found: ${id}`);
    }
    
    if (!task.output?.rawMarkdown) {
      reply.status(400);
      throw new Error('Task has no initial documentation to enhance');
    }
    
    if (!transcript || transcript.trim().length === 0) {
      // No clarification transcript, nothing to do
      return {
        success: true,
        updatedMarkdown: task.output.rawMarkdown,
      };
    }
    
    fastify.log.info(
      { taskId: id, transcriptLength: transcript.length },
      'Processing clarification transcript'
    );
    
    try {
      // Import the LLM complete function
      const { complete } = await import('../services/llm.js');
      
      // Re-generate documentation with clarifications
      const enhancedMarkdown = await regenerateWithClarifications(
        task.output.rawMarkdown,
        transcript,
        complete
      );
      
      // Update task with enhanced documentation
      task.output.rawMarkdown = enhancedMarkdown;
      task.clarificationTranscript = transcript;
      await setTask(id, task);
      
      // Save enhanced result to file (only works in local dev)
      await saveResult(id, enhancedMarkdown, 'final');
      
      fastify.log.info({ taskId: id }, 'Documentation enhanced with clarifications');
      
      return {
        success: true,
        updatedMarkdown: enhancedMarkdown,
      };
    } catch (error) {
      fastify.log.error({ taskId: id, error: (error as Error).message }, 'Failed to process clarifications');
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  });
}

// ============================================
// Save results to file
// ============================================

async function saveResult(taskId: string, markdown: string, stage: 'initial' | 'final'): Promise<void> {
  try {
    // Ensure results directory exists
    await mkdir(RESULTS_DIR, { recursive: true });
    
    // Create filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}_${taskId.slice(0, 8)}_${stage}.md`;
    const filepath = join(RESULTS_DIR, filename);
    
    // Add metadata header
    const content = `<!--
Task ID: ${taskId}
Stage: ${stage}
Generated: ${new Date().toISOString()}
-->

${markdown}`;
    
    await writeFile(filepath, content, 'utf-8');
    console.log(`[Results] Saved to: ${filepath}`);
  } catch (error) {
    console.error('[Results] Failed to save:', error);
    // Don't throw - saving is optional
  }
}

// ============================================
// Regenerate documentation with clarifications
// ============================================

async function regenerateWithClarifications(
  originalMarkdown: string,
  clarificationTranscript: string,
  llmComplete: (prompt: string, options?: { systemPrompt?: string; maxTokens?: number }) => Promise<string>
): Promise<string> {
  const systemPrompt = `Eres un experto en documentación de procesos para Digital Workers.

Tu trabajo es MEJORAR la documentación existente incorporando las clarificaciones que el usuario proporcionó en la conversación.

## Reglas
1. MANTÉN la estructura existente (# Summary, # Instructions, # Know-How)
2. AÑADE información nueva de las clarificaciones, no elimines lo existente a menos que sea incorrecto
3. Si el usuario corrigió algo, actualiza esa parte específica
4. Si el usuario añadió criterios de decisión, añádelos al Know-How
5. Si el usuario mencionó casos límite, añádelos como corner cases
6. Escribe en español, modo imperativo para instrucciones ("Verifica", "Busca")
7. Sé específico y concreto, no genérico

## Output
Devuelve SOLO el documento Markdown mejorado, sin explicaciones adicionales.
Empieza directamente con "# Summary"`;

  const userPrompt = `## DOCUMENTACIÓN ORIGINAL

${originalMarkdown}

---

## TRANSCRIPCIÓN DE LA CONVERSACIÓN DE CLARIFICACIÓN

${clarificationTranscript}

---

Ahora mejora la documentación incorporando las clarificaciones. 
Si el usuario confirmó que todo está correcto, devuelve la documentación original sin cambios.
Si añadió información nueva, incorpórala en la sección apropiada.`;

  const result = await llmComplete(userPrompt, {
    systemPrompt,
    maxTokens: 4096,
  });
  
  return result.trim();
}

// ============================================
// Helper functions for agent briefing
// ============================================

function generateActionsSummary(actions: Action[]): string {
  if (actions.length === 0) return 'No se grabaron acciones.';
  
  // Group actions by URL/page
  const pageGroups = new Map<string, Action[]>();
  for (const action of actions) {
    const domain = new URL(action.url).hostname;
    const existing = pageGroups.get(domain) || [];
    existing.push(action);
    pageGroups.set(domain, existing);
  }
  
  const lines: string[] = [];
  
  for (const [domain, pageActions] of pageGroups) {
    lines.push(`\n**${domain}** (${pageActions.length} acciones):`);
    
    // Summarize by type
    const clicks = pageActions.filter(a => a.type === 'click');
    const inputs = pageActions.filter(a => a.type === 'input');
    const navs = pageActions.filter(a => a.type === 'navigation');
    
    if (clicks.length > 0) {
      const clickTargets = clicks
        .map(c => c.target?.text || c.target?.selector || 'elemento')
        .slice(0, 5);
      lines.push(`  - Clicks: ${clickTargets.join(', ')}${clicks.length > 5 ? '...' : ''}`);
    }
    
    if (inputs.length > 0) {
      lines.push(`  - Inputs: ${inputs.length} campos`);
    }
    
    if (navs.length > 0) {
      lines.push(`  - Navegaciones: ${navs.length}`);
    }
  }
  
  return lines.join('\n');
}

interface Discrepancy {
  type: 'pause' | 'backtrack' | 'repeat' | 'narration_action_mismatch';
  description: string;
  relevantAction?: Action;
}

function detectDiscrepancies(task: TaskSession): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];
  
  // Detect long pauses (potential decision points)
  for (let i = 1; i < task.actions.length; i++) {
    const gap = task.actions[i].timestamp - task.actions[i - 1].timestamp;
    if (gap > 5000) { // More than 5 seconds
      discrepancies.push({
        type: 'pause',
        description: `Pausa de ${Math.round(gap / 1000)}s antes de "${task.actions[i].target?.text || task.actions[i].type}"`,
        relevantAction: task.actions[i],
      });
    }
  }
  
  // Detect back-and-forth navigation
  const urls = task.actions.filter(a => a.type === 'navigation').map(a => a.url);
  for (let i = 2; i < urls.length; i++) {
    if (urls[i] === urls[i - 2] && urls[i] !== urls[i - 1]) {
      discrepancies.push({
        type: 'backtrack',
        description: `El usuario volvió atrás desde una página`,
      });
      break; // Only report once
    }
  }
  
  // Detect repeated clicks on similar elements
  const clickTexts = task.actions
    .filter(a => a.type === 'click' && a.target?.text)
    .map(a => a.target!.text!.toLowerCase());
  
  const clickCounts = new Map<string, number>();
  for (const text of clickTexts) {
    clickCounts.set(text, (clickCounts.get(text) || 0) + 1);
  }
  
  for (const [text, count] of clickCounts) {
    if (count >= 3) {
      discrepancies.push({
        type: 'repeat',
        description: `Click repetido ${count} veces en "${text}"`,
      });
    }
  }
  
  return discrepancies.slice(0, 5); // Max 5 discrepancies
}

function generateSuggestedQuestions(task: TaskSession, _discrepancies: Discrepancy[]): string[] {
  const questions: string[] = [];
  
  // Analyze the generated output for gaps
  const output = task.output?.rawMarkdown || '';
  const knowHow = task.knowHowExtraction;
  
  // Check for incomplete know-how
  if (knowHow?.decisionCriteria?.some(c => !c.criterion || c.criterion === 'undefined')) {
    questions.push('Hay criterios de decisión que no quedaron claros. ¿Podrías explicar cómo decides qué elementos seleccionar?');
  }
  
  // Check for missing corner cases
  if (!knowHow?.cornerCases?.length) {
    questions.push('¿Qué haces si algo falla o no encuentras lo que buscas?');
  }
  
  // Check for vague instructions
  if (output.includes('según') || output.includes('depende') || output.includes('normalmente')) {
    questions.push('Hay algunas instrucciones que dicen "depende" o "normalmente". ¿Podrías ser más específico sobre cuándo aplicar cada caso?');
  }
  
  // Check for missing validation criteria
  if (!output.includes('verificar') && !output.includes('comprobar') && !output.includes('validar')) {
    questions.push('¿Cómo verificas que los datos extraídos son correctos?');
  }
  
  // Generic questions if nothing specific found
  if (questions.length === 0) {
    questions.push('¿Falta algún paso importante que no haya capturado?');
    questions.push('¿Hay algún caso especial o excepción que deba tener en cuenta?');
  }
  
  return questions.slice(0, 3); // Max 3 questions
}

interface BriefingParams {
  actionsSummary: string;
  narration: string;
  discrepancies: Discrepancy[];
  suggestedQuestions: string[];
  llmAnalysis: string;
  duration: number;
  actionCount: number;
}

function buildAgentBriefing(params: BriefingParams): string {
  // Pass the generated documentation directly to the agent
  // The LLM already created a well-structured document
  let briefing = params.llmAnalysis;

  // Only add narration if the user provided voice notes during recording
  if (params.narration) {
    briefing += `

---

## NARRACIÓN DEL USUARIO
"${params.narration}"
`;
  }

  return briefing;
}

/**
 * Build a summary of the LLM analysis for the agent
 * Simply returns the generated Markdown document - no need to reconstruct it
 */
function buildLLMAnalysisSummary(task: TaskSession): string {
  // The LLM already generated a well-structured document with:
  // - Summary (objective and scope)
  // - Instructions (step-by-step execution)
  // - Know-How (business rules and criteria)
  // Just pass it directly to the clarification agent
  if (task.output?.rawMarkdown) {
    return task.output.rawMarkdown;
  }
  
  return 'No hay documentación generada aún.';
}

