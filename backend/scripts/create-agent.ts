#!/usr/bin/env npx tsx
// ============================================
// Script to create the Clarification Agent in Eleven Labs
// Run with: npx tsx scripts/create-agent.ts
// ============================================

import 'dotenv/config';
import { CLARIFICATION_AGENT_SYSTEM_PROMPT, AGENT_CONFIG } from '../src/prompts/clarification-agent.js';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g., https://abc123.ngrok.io/webhook/elevenlabs

if (!ELEVENLABS_API_KEY) {
  console.error('❌ ELEVENLABS_API_KEY not found in .env');
  process.exit(1);
}

if (!WEBHOOK_URL) {
  console.warn('⚠️  WEBHOOK_URL not set - transcripts will not be automatically captured');
  console.warn('   Set WEBHOOK_URL in .env (use ngrok for local development)\n');
}

async function createAgent() {
  console.log('🤖 Creating Clarification Agent in Eleven Labs...\n');

  // First, let's list available voices to pick a Spanish one
  console.log('📋 Fetching available voices...');
  
  const voicesResponse = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
    },
  });

  if (!voicesResponse.ok) {
    console.error('❌ Failed to fetch voices:', await voicesResponse.text());
    process.exit(1);
  }

  const voicesData = await voicesResponse.json();
  const voices = voicesData.voices || [];
  
  // Find a suitable Spanish voice or use a multilingual one
  const spanishVoice = voices.find((v: any) => 
    v.labels?.language === 'es' || 
    v.name.toLowerCase().includes('spanish') ||
    v.labels?.accent === 'spanish'
  );
  
  const selectedVoice = spanishVoice || voices.find((v: any) => 
    v.labels?.use_case === 'conversational' ||
    v.name === 'Rachel' ||
    v.name === 'Sarah'
  ) || voices[0];

  console.log(`✅ Selected voice: ${selectedVoice.name} (${selectedVoice.voice_id})\n`);

  // Create the conversational agent
  console.log('🔧 Creating conversational agent...');

  const agentPayload = {
    name: AGENT_CONFIG.name,
    conversation_config: {
      agent: {
        prompt: {
          prompt: CLARIFICATION_AGENT_SYSTEM_PROMPT.replace('{{TASK_CONTEXT}}', 
            '(El contexto de la tarea se proporcionará dinámicamente en cada sesión)'),
          llm: 'gemini-2.0-flash', // Required for non-English
        },
        first_message: AGENT_CONFIG.firstMessage
          .replace('{{ACTION_COUNT}}', 'varias')
          .replace('{{DURATION}}', 'unos minutos')
          .replace('{{QUESTION_COUNT}}', 'algunas'),
        language: 'es',
        // Define dynamic variables that will be passed at runtime
        dynamic_variables: {
          dynamic_variable_placeholders: {
            generated_docs: {
              value: '(Documentación pendiente de cargar)',
              description: 'La documentación generada automáticamente que el agente debe verificar',
            },
            user_narration: {
              value: '',
              description: 'Lo que el usuario narró durante la grabación',
            },
          },
        },
      },
      tts: {
        model_id: 'eleven_turbo_v2_5', // Required for non-English agents
        voice_id: selectedVoice.voice_id,
        stability: AGENT_CONFIG.stability,
        similarity_boost: AGENT_CONFIG.similarityBoost,
      },
      conversation: {
        max_duration_seconds: AGENT_CONFIG.maxDurationSeconds,
        client_events: ['conversation_initiation_metadata', 'agent_response', 'user_transcript'],
      },
    },
  };

  const createResponse = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(agentPayload),
  });

  if (!createResponse.ok) {
    const errorText = await createResponse.text();
    console.error('❌ Failed to create agent:', errorText);
    
    // Try alternative endpoint
    console.log('\n🔄 Trying alternative approach...');
    
    // List existing agents
    const listResponse = await fetch('https://api.elevenlabs.io/v1/convai/agents', {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
      },
    });
    
    if (listResponse.ok) {
      const agents = await listResponse.json();
      console.log('📋 Existing agents:', JSON.stringify(agents, null, 2));
    }
    
    console.log('\n📝 To create the agent manually:');
    console.log('1. Go to https://elevenlabs.io/app/conversational-ai');
    console.log('2. Click "Create Agent"');
    console.log('3. Use this system prompt:\n');
    console.log('---');
    console.log(CLARIFICATION_AGENT_SYSTEM_PROMPT.substring(0, 500) + '...');
    console.log('---\n');
    console.log('4. Copy the Agent ID and add it to .env as ELEVENLABS_AGENT_ID');
    
    process.exit(1);
  }

  const agentData = await createResponse.json();
  
  console.log('✅ Agent created successfully!\n');
  console.log('📋 Agent Details:');
  console.log(`   ID: ${agentData.agent_id}`);
  console.log(`   Name: ${agentData.name || AGENT_CONFIG.name}`);
  console.log('\n📝 Add this to your .env file:');
  console.log(`ELEVENLABS_AGENT_ID=${agentData.agent_id}`);
  
  return agentData.agent_id;
}

// Also provide a function to update an existing agent
async function updateAgent(agentId: string) {
  console.log(`🔄 Updating agent ${agentId}...`);
  
  const agentConfig: Record<string, unknown> = {
    conversation_config: {
      agent: {
        prompt: {
          prompt: CLARIFICATION_AGENT_SYSTEM_PROMPT,
        },
        first_message: AGENT_CONFIG.firstMessage,
        // Define dynamic variables placeholders (will be overridden at runtime)
        dynamic_variables: {
          dynamic_variable_placeholders: {
            generated_docs: '(Documentación pendiente de cargar)',
            user_narration: '(Sin narración)',
          },
        },
      },
    },
  };
  
  // Add webhook if URL is configured
  if (WEBHOOK_URL) {
    (agentConfig as any).webhook = {
      url: WEBHOOK_URL,
      events: ['post_call_transcription'],
    };
    console.log(`📡 Configuring webhook: ${WEBHOOK_URL}`);
  }
  
  const updateResponse = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
    method: 'PATCH',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY!,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(agentConfig),
  });

  if (!updateResponse.ok) {
    console.error('❌ Failed to update agent:', await updateResponse.text());
    return false;
  }

  console.log('✅ Agent updated successfully!');
  if (WEBHOOK_URL) {
    console.log('📡 Webhook configured for post-call transcripts');
  }
  return true;
}

// Main
const existingAgentId = process.env.ELEVENLABS_AGENT_ID;

if (existingAgentId) {
  console.log(`📝 Found existing agent ID: ${existingAgentId}`);
  console.log('   Updating with latest prompt...\n');
  await updateAgent(existingAgentId);
} else {
  await createAgent();
}

