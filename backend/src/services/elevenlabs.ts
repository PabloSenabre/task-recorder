// ============================================
// Task Recorder Backend - Eleven Labs Service
// Handles transcription and conversational AI
// ============================================

import { ElevenLabsClient } from 'elevenlabs';
import { Readable } from 'stream';

// ============================================
// Configuration
// ============================================

let client: ElevenLabsClient | null = null;

function getClient(): ElevenLabsClient {
  if (!client) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error('ELEVENLABS_API_KEY environment variable is required');
    }
    client = new ElevenLabsClient({ apiKey });
  }
  return client;
}

// ============================================
// Speech to Text (Transcription)
// ============================================

export interface TranscriptionResult {
  text: string;
  segments: Array<{
    text: string;
    start: number;
    end: number;
  }>;
}

/**
 * Transcribe audio buffer to text using Eleven Labs
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  language: string = 'es'
): Promise<TranscriptionResult> {
  const client = getClient();
  
  console.log('[ElevenLabs] Transcribing audio...', {
    size: audioBuffer.length,
    language
  });

  try {
    // Convert Buffer to Uint8Array for File constructor
    const uint8Array = new Uint8Array(audioBuffer);
    const audioBlob = new Blob([uint8Array], { type: 'audio/webm' });
    
    const result = await client.speechToText.convert({
      file: audioBlob,
      model_id: 'scribe_v1', // Eleven Labs speech-to-text model
      language_code: language,
    });

    console.log('[ElevenLabs] Transcription complete');
    
    // Handle the response - structure may vary by SDK version
    const text = typeof result === 'string' ? result : (result as { text?: string }).text || '';
    
    return {
      text,
      segments: [] // Segments may not be available in all API versions
    };
  } catch (error) {
    console.error('[ElevenLabs] Transcription error:', error);
    throw new Error(`Transcription failed: ${(error as Error).message}`);
  }
}

// ============================================
// Conversational AI Agent
// ============================================

export interface AgentContext {
  taskSummary: string;
  actionsSummary: string;
  userNarration: string;
  discrepancies: string[];
  suggestedQuestions: string[];
}

export interface ConversationSession {
  agentId: string;
  sessionUrl: string;
  signedUrl: string;
}

/**
 * Create or get the clarification agent
 * Returns the agent ID
 */
export async function getOrCreateAgent(): Promise<string> {
  // Check if agent ID is configured
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  if (agentId) {
    console.log('[ElevenLabs] Using configured agent:', agentId);
    return agentId;
  }

  // For now, throw an error - agent should be created in dashboard
  // TODO: Create agent via API if needed
  throw new Error(
    'ELEVENLABS_AGENT_ID not configured. Please create an agent in the Eleven Labs dashboard ' +
    'and add the agent ID to your .env file.'
  );
}

/**
 * Generate the system prompt for the clarification agent
 * This will be passed as dynamic context
 */
export function generateAgentPrompt(context: AgentContext): string {
  return `Eres un asistente que ayuda a documentar tareas de negocio para Digital Workers.
Tu objetivo es clarificar la intención y el conocimiento experto detrás de las acciones del usuario.

## CONTEXTO DE LA TAREA
${context.taskSummary}

## ACCIONES OBSERVADAS
${context.actionsSummary}

## LO QUE DIJO EL USUARIO (narración)
${context.userNarration}

## DISCREPANCIAS DETECTADAS
${context.discrepancies.length > 0 
  ? context.discrepancies.map((d, i) => `${i + 1}. ${d}`).join('\n')
  : 'No se detectaron discrepancias significativas.'}

## PREGUNTAS SUGERIDAS
${context.suggestedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

## TU TRABAJO
1. Saluda brevemente y menciona que has observado la tarea
2. Haz las preguntas sugeridas de forma natural y conversacional
3. Si la respuesta es vaga, profundiza con preguntas de seguimiento
4. Extrae el "por qué" detrás de las decisiones
5. Cuando tengas suficiente información (3-5 intercambios), despídete amablemente
6. Confirma que generarás la documentación con la información recopilada

## ESTILO
- Sé conciso y profesional
- Habla en español
- No seas demasiado formal, pero tampoco coloquial
- Muestra que entiendes el contexto
`;
}

/**
 * Get the widget configuration for the agent
 */
export function getAgentWidgetConfig(agentId: string, context: AgentContext): object {
  return {
    agentId,
    // Dynamic variables that will be injected into the agent's prompt
    dynamicVariables: {
      task_summary: context.taskSummary,
      actions_summary: context.actionsSummary,
      user_narration: context.userNarration,
      discrepancies: context.discrepancies.join('\n'),
      suggested_questions: context.suggestedQuestions.join('\n'),
    },
    // Configuration for the widget
    config: {
      language: 'es',
      // Callback URL when conversation ends
      // The widget will POST the transcript here
    }
  };
}

// ============================================
// Discrepancy Detection
// ============================================

export interface DiscrepancyAnalysis {
  discrepancies: string[];
  suggestedQuestions: string[];
  uncertaintyMoments: Array<{
    timestamp: number;
    narration: string;
    action: string;
  }>;
}

/**
 * Analyze narration vs actions to detect discrepancies
 * Uses LLM to compare what was said vs what was done
 */
export async function analyzeDiscrepancies(
  narration: string,
  actionsSummary: string,
  llmComplete: (prompt: string) => Promise<string>
): Promise<DiscrepancyAnalysis> {
  const prompt = `Analiza la siguiente narración del usuario y las acciones que realizó.
Detecta discrepancias, momentos de incertidumbre y genera preguntas de clarificación.

## NARRACIÓN DEL USUARIO
${narration}

## ACCIONES REALIZADAS (DOM)
${actionsSummary}

## TU TAREA
Identifica:
1. **Discrepancias**: Cuando el usuario dijo una cosa pero hizo otra
2. **Incertidumbre**: Frases como "no sé si...", "creo que...", "debería..."
3. **Acciones sin explicar**: Acciones que no fueron narradas
4. **Pausas significativas**: Si hay gaps en la narración

## FORMATO DE RESPUESTA (XML)
<analysis>
  <discrepancies>
    <item>Descripción de la discrepancia 1</item>
    <item>Descripción de la discrepancia 2</item>
  </discrepancies>
  <suggested_questions>
    <question>Pregunta 1 para clarificar</question>
    <question>Pregunta 2 para clarificar</question>
    <question>Pregunta 3 para clarificar</question>
  </suggested_questions>
  <uncertainty_moments>
    <moment>
      <narration>Lo que dijo el usuario</narration>
      <action>Lo que hizo</action>
    </moment>
  </uncertainty_moments>
</analysis>`;

  try {
    const response = await llmComplete(prompt);
    
    // Parse XML response
    const discrepancies = extractXmlArray(response, 'discrepancies', 'item');
    const suggestedQuestions = extractXmlArray(response, 'suggested_questions', 'question');
    
    return {
      discrepancies,
      suggestedQuestions,
      uncertaintyMoments: [] // TODO: Parse uncertainty_moments
    };
  } catch (error) {
    console.error('[ElevenLabs] Discrepancy analysis failed:', error);
    return {
      discrepancies: [],
      suggestedQuestions: [
        '¿Puedes explicar el objetivo principal de esta tarea?',
        '¿Hay algo que debería saber para replicar este proceso?',
        '¿Qué criterios usas para tomar las decisiones clave?'
      ],
      uncertaintyMoments: []
    };
  }
}

// Helper to extract arrays from XML
function extractXmlArray(xml: string, parentTag: string, itemTag: string): string[] {
  const parentMatch = xml.match(new RegExp(`<${parentTag}>([\\s\\S]*?)</${parentTag}>`));
  if (!parentMatch) return [];
  
  const items: string[] = [];
  const itemRegex = new RegExp(`<${itemTag}>([\\s\\S]*?)</${itemTag}>`, 'g');
  let match;
  
  while ((match = itemRegex.exec(parentMatch[1])) !== null) {
    items.push(match[1].trim());
  }
  
  return items;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Check if Eleven Labs is configured
 */
export function isConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/**
 * Test connection to Eleven Labs
 */
export async function testConnection(): Promise<boolean> {
  try {
    const client = getClient();
    // Simple API call to test connection
    await client.voices.getAll();
    return true;
  } catch {
    return false;
  }
}

