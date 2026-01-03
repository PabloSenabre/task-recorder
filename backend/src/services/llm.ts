// ============================================
// Task Recorder Backend - LLM Adapter
// Configurable adapter for Claude and OpenAI
// ============================================

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMProvider } from '../types.js';

// ============================================
// Configuration
// ============================================

const DEFAULT_MAX_TOKENS = 4096;

// OpenAI models to try in order of preference (fallback chain)
// gpt-4o is the default - good balance of speed, capability, and availability
const OPENAI_MODEL_FALLBACK_CHAIN = [
  'gpt-4o',           // Default: GPT-4 Omni - fast and capable
  'gpt-4o-mini',      // Faster, cheaper variant
  'gpt-4-turbo',      // GPT-4 Turbo
  'gpt-4',            // Original GPT-4
  'gpt-3.5-turbo',    // Fallback to GPT-3.5
];

// Claude models to try in order of preference (fallback chain)
const CLAUDE_MODEL_FALLBACK_CHAIN = [
  'claude-sonnet-4-20250514',
  'claude-3-5-sonnet-20241022',
  'claude-3-sonnet-20240229',
  'claude-3-haiku-20240307',
];

interface LLMConfig {
  provider: LLMProvider;
  models: string[]; // List of models to try in order
  maxTokens?: number;
}

function getConfig(): LLMConfig {
  const provider = (process.env.LLM_PROVIDER || 'openai') as LLMProvider;
  
  let models: string[];
  if (provider === 'claude') {
    const preferredModel = process.env.CLAUDE_MODEL;
    models = preferredModel 
      ? [preferredModel, ...CLAUDE_MODEL_FALLBACK_CHAIN.filter(m => m !== preferredModel)]
      : CLAUDE_MODEL_FALLBACK_CHAIN;
  } else {
    const preferredModel = process.env.OPENAI_MODEL;
    models = preferredModel 
      ? [preferredModel, ...OPENAI_MODEL_FALLBACK_CHAIN.filter(m => m !== preferredModel)]
      : OPENAI_MODEL_FALLBACK_CHAIN;
  }

  return {
    provider,
    models,
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || String(DEFAULT_MAX_TOKENS), 10),
  };
}

// ============================================
// Client Initialization
// ============================================

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required');
    }
    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

// ============================================
// LLM Completion
// ============================================

export interface CompletionOptions {
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Send a prompt to the configured LLM and get a response
 * Tries multiple models in fallback chain if one fails
 */
export async function complete(
  prompt: string,
  options: CompletionOptions = {}
): Promise<string> {
  const config = getConfig();
  const maxTokens = options.maxTokens || config.maxTokens || DEFAULT_MAX_TOKENS;
  const temperature = options.temperature ?? 0.3;

  const errors: Array<{ model: string; error: string }> = [];

  for (const model of config.models) {
    console.log(`[LLM] Trying ${config.provider} (${model})...`);

    try {
      let result: string;
      if (config.provider === 'claude') {
        result = await completeWithClaude(prompt, { ...options, maxTokens, temperature }, model);
      } else {
        result = await completeWithOpenAI(prompt, { ...options, maxTokens, temperature }, model);
      }
      console.log(`[LLM] Success with ${config.provider} (${model})`);
      return result;
    } catch (error) {
      const errorMessage = (error as Error).message;
      console.warn(`[LLM] Model ${model} failed: ${errorMessage}`);
      errors.push({ model, error: errorMessage });
      
      // If it's a rate limit or temporary error, might want to retry same model
      // For now, just move to next model in chain
      continue;
    }
  }

  // All models failed
  const errorSummary = errors.map(e => `${e.model}: ${e.error}`).join('\n  ');
  throw new Error(`All ${config.provider} models failed:\n  ${errorSummary}`);
}

async function completeWithClaude(
  prompt: string,
  options: { systemPrompt?: string; maxTokens: number; temperature: number },
  model: string
): Promise<string> {
  const client = getAnthropicClient();

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: prompt },
  ];

  const response = await client.messages.create({
    model,
    max_tokens: options.maxTokens,
    temperature: options.temperature,
    system: options.systemPrompt,
    messages,
  });

  // Extract text from response
  const textBlock = response.content.find(block => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}

async function completeWithOpenAI(
  prompt: string,
  options: { systemPrompt?: string; maxTokens: number; temperature: number },
  model: string
): Promise<string> {
  const client = getOpenAIClient();

  // Build messages array according to OpenAI API specification
  // https://platform.openai.com/docs/api-reference/chat/create
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  // System message should come first if provided
  if (options.systemPrompt) {
    messages.push({ 
      role: 'system', 
      content: options.systemPrompt 
    });
  }

  // User message
  messages.push({ 
    role: 'user', 
    content: prompt 
  });

  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: options.maxTokens,
      temperature: options.temperature,
      // Additional parameters that might be useful:
      // top_p: 1.0, // Default, can be adjusted if needed
      // frequency_penalty: 0, // Default
      // presence_penalty: 0, // Default
    });

    // Extract content from response
    // According to API docs, choices[0].message.content should contain the text
    const firstChoice = response.choices[0];
    
    if (!firstChoice) {
      throw new Error('No choices returned from OpenAI API');
    }

    const content = firstChoice.message?.content;
    
    if (!content) {
      // Check if there's a finish_reason that might explain the issue
      const finishReason = firstChoice.finish_reason;
      if (finishReason === 'length') {
        throw new Error('Response was truncated due to max_tokens limit');
      } else if (finishReason === 'content_filter') {
        throw new Error('Response was filtered by content filter');
      } else {
        throw new Error(`No content in response. Finish reason: ${finishReason || 'unknown'}`);
      }
    }

    return content;
  } catch (error) {
    // Enhanced error handling
    if (error instanceof OpenAI.APIError) {
      // OpenAI-specific error
      throw new Error(`OpenAI API Error: ${error.message} (Status: ${error.status})`);
    } else if (error instanceof Error) {
      throw error;
    } else {
      throw new Error(`Unknown error: ${String(error)}`);
    }
  }
}

// ============================================
// Pipeline Execution
// ============================================

export interface PipelineStep {
  name: string;
  prompt: string;
  maxTokens?: number;
}

/**
 * Execute multiple LLM calls in sequence
 * Each step can use the output of previous steps
 */
export async function executePipeline(
  steps: PipelineStep[]
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  for (const step of steps) {
    console.log(`[LLM Pipeline] Executing step: ${step.name}`);
    const startTime = Date.now();

    try {
      const response = await complete(step.prompt, {
        maxTokens: step.maxTokens,
      });

      results.set(step.name, response);

      const duration = Date.now() - startTime;
      console.log(`[LLM Pipeline] Step "${step.name}" completed in ${duration}ms`);
    } catch (error) {
      console.error(`[LLM Pipeline] Step "${step.name}" failed:`, error);
      throw new Error(`Pipeline step "${step.name}" failed: ${(error as Error).message}`);
    }
  }

  return results;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Get current LLM configuration (for debugging)
 */
export function getLLMConfig(): { provider: LLMProvider; models: string[] } {
  const config = getConfig();
  return {
    provider: config.provider,
    models: config.models,
  };
}

/**
 * Test LLM connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    await complete('Say "OK" if you can read this.', { maxTokens: 10 });
    return true;
  } catch {
    return false;
  }
}

