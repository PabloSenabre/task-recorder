// ============================================
// Task Recorder Backend - Eleven Labs Webhook
// Receives conversation transcripts after calls end
// ============================================

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac } from 'crypto';
import { getTask, setTask, getTaskIdForConversation, clearConversation } from '../store/index.js';

// ============================================
// Webhook Types
// ============================================

interface ElevenLabsWebhookPayload {
  type: 'post_call_transcription' | 'post_call_audio' | 'call_initiation_failure';
  event_timestamp: number;
  data: {
    agent_id: string;
    conversation_id: string;
    status: 'done' | 'failed';
    transcript: Array<{
      role: 'agent' | 'user';
      message: string;
      timestamp: number;
    }>;
    metadata?: Record<string, string>;
    call_duration_seconds: number;
    cost_credits: number;
  };
}

// ============================================
// HMAC Verification
// ============================================

const WEBHOOK_SECRET = process.env.ELEVENLABS_WEBHOOK_SECRET || '';
const TIMESTAMP_TOLERANCE_MS = 30 * 60 * 1000; // 30 minutes

function verifyWebhookSignature(
  signature: string | undefined,
  rawBody: string
): { valid: boolean; error?: string } {
  // If no secret configured, skip verification (for testing)
  if (!WEBHOOK_SECRET) {
    console.warn('[Webhook] No ELEVENLABS_WEBHOOK_SECRET configured, skipping HMAC verification');
    return { valid: true };
  }

  if (!signature) {
    return { valid: false, error: 'Missing ElevenLabs-Signature header' };
  }

  // Parse signature header: t=timestamp,v0=hash
  const parts = signature.split(',');
  const timestampPart = parts.find(p => p.startsWith('t='));
  const hashPart = parts.find(p => p.startsWith('v0='));

  if (!timestampPart || !hashPart) {
    return { valid: false, error: 'Invalid signature format' };
  }

  const timestamp = timestampPart.substring(2);
  const providedHash = hashPart;

  // Validate timestamp (not older than 30 minutes)
  const requestTimestamp = parseInt(timestamp, 10) * 1000;
  const tolerance = Date.now() - TIMESTAMP_TOLERANCE_MS;
  
  if (requestTimestamp < tolerance) {
    return { valid: false, error: 'Request expired' };
  }

  // Validate HMAC signature
  const message = `${timestamp}.${rawBody}`;
  const expectedHash = 'v0=' + createHmac('sha256', WEBHOOK_SECRET)
    .update(message)
    .digest('hex');

  if (providedHash !== expectedHash) {
    return { valid: false, error: 'Invalid signature' };
  }

  return { valid: true };
}

// ============================================
// Helper Functions
// ============================================

// Re-export for use in other modules
export { registerConversation } from '../store/index.js';

// ============================================
// LLM Regeneration Function
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
// Webhook Routes
// ============================================

export async function webhookRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Add raw body parsing for HMAC verification
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      // Store raw body for HMAC verification
      (req as any).rawBody = body;
      const json = JSON.parse(body as string);
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // POST /webhook/elevenlabs - Receive Eleven Labs webhook
  fastify.post<{
    Body: ElevenLabsWebhookPayload;
  }>('/elevenlabs', async (request: FastifyRequest<{ Body: ElevenLabsWebhookPayload }>, reply: FastifyReply) => {
    
    // Verify HMAC signature
    const signature = request.headers['elevenlabs-signature'] as string | undefined;
    const rawBody = (request as any).rawBody as string;
    
    const verification = verifyWebhookSignature(signature, rawBody);
    if (!verification.valid) {
      fastify.log.warn({ error: verification.error }, 'Webhook signature verification failed');
      reply.status(401);
      return { success: false, error: verification.error };
    }
    
    const payload = request.body;
    
    fastify.log.info({
      type: payload.type,
      conversationId: payload.data?.conversation_id,
      status: payload.data?.status,
    }, 'Received Eleven Labs webhook');
    
    // Validate webhook type
    if (payload.type !== 'post_call_transcription') {
      fastify.log.warn({ type: payload.type }, 'Ignoring non-transcript webhook');
      return { success: true, message: 'Ignored - not a transcript webhook' };
    }
    
    const { conversation_id, transcript, status, metadata } = payload.data;
    
    if (status !== 'done') {
      fastify.log.warn({ status }, 'Conversation did not complete successfully');
      return { success: true, message: 'Ignored - conversation not completed' };
    }
    
    // Get task ID from metadata or conversation mapping
    let taskId = metadata?.taskId || getTaskIdForConversation(conversation_id);
    
    if (!taskId) {
      fastify.log.warn({ conversation_id }, 'No task ID found for conversation');
      return { success: true, message: 'No task ID found, transcript ignored' };
    }
    
    // Format transcript
    const formattedTranscript = transcript
      .map(t => `**${t.role === 'agent' ? 'Agente' : 'Usuario'}:** ${t.message}`)
      .join('\n\n');
    
    try {
      // Get the task
      const task = await getTask(taskId);
      
      if (!task || !task.output?.rawMarkdown) {
        fastify.log.warn({ taskId }, 'Task not found or no initial markdown');
        return { success: false, error: 'Task not found or no initial markdown' };
      }
      
      // Import LLM and regenerate
      const { complete } = await import('../services/llm.js');
      
      fastify.log.info({ taskId }, 'Regenerating documentation with clarifications');
      
      // Regenerate with clarifications
      const enhancedMarkdown = await regenerateWithClarifications(
        task.output.rawMarkdown,
        formattedTranscript,
        complete
      );
      
      // Update task
      task.output.rawMarkdown = enhancedMarkdown;
      task.clarificationTranscript = formattedTranscript;
      await setTask(taskId, task);
      
      // Cleanup conversation mapping
      clearConversation(conversation_id);
      
      fastify.log.info({ taskId }, 'Documentation enhanced successfully via webhook');
      
      return {
        success: true,
        taskId,
        messageCount: transcript.length,
        enhanced: true,
      };
    } catch (error) {
      fastify.log.error({ error: (error as Error).message }, 'Failed to process webhook');
      reply.status(500);
      return { success: false, error: (error as Error).message };
    }
  });
  
  // GET /webhook/status - Check webhook endpoint status
  fastify.get('/status', async () => {
    return {
      status: 'ready',
      hmacConfigured: !!WEBHOOK_SECRET,
      timestamp: Date.now(),
    };
  });
}
