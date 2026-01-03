// ============================================
// Task Store - Abstract storage layer
// Supports both in-memory (dev) and Vercel KV (prod)
// ============================================

import type { TaskSession } from '../types.js';

// Storage interface
interface TaskStore {
  get(id: string): Promise<TaskSession | null>;
  set(id: string, task: TaskSession): Promise<void>;
  delete(id: string): Promise<boolean>;
  list(): Promise<TaskSession[]>;
}

// ============================================
// In-Memory Store (for local development)
// ============================================

const memoryStore = new Map<string, TaskSession>();

const inMemoryStore: TaskStore = {
  async get(id: string): Promise<TaskSession | null> {
    return memoryStore.get(id) || null;
  },
  
  async set(id: string, task: TaskSession): Promise<void> {
    memoryStore.set(id, task);
  },
  
  async delete(id: string): Promise<boolean> {
    return memoryStore.delete(id);
  },
  
  async list(): Promise<TaskSession[]> {
    return Array.from(memoryStore.values());
  },
};

// ============================================
// Vercel KV Store (for production)
// ============================================

let kvStore: TaskStore | null = null;

async function createKVStore(): Promise<TaskStore> {
  // Dynamic import to avoid errors when @vercel/kv is not installed
  const { kv } = await import('@vercel/kv');
  
  const TASK_PREFIX = 'task:';
  const TASK_LIST_KEY = 'tasks:list';
  
  return {
    async get(id: string): Promise<TaskSession | null> {
      return await kv.get<TaskSession>(`${TASK_PREFIX}${id}`);
    },
    
    async set(id: string, task: TaskSession): Promise<void> {
      // Store the task
      await kv.set(`${TASK_PREFIX}${id}`, task);
      
      // Add to list of task IDs (for listing)
      await kv.sadd(TASK_LIST_KEY, id);
      
      // Set TTL of 24 hours for auto-cleanup
      await kv.expire(`${TASK_PREFIX}${id}`, 86400);
    },
    
    async delete(id: string): Promise<boolean> {
      const result = await kv.del(`${TASK_PREFIX}${id}`);
      await kv.srem(TASK_LIST_KEY, id);
      return result > 0;
    },
    
    async list(): Promise<TaskSession[]> {
      const ids = await kv.smembers(TASK_LIST_KEY);
      const tasks: TaskSession[] = [];
      
      for (const id of ids) {
        const task = await kv.get<TaskSession>(`${TASK_PREFIX}${id}`);
        if (task) {
          tasks.push(task);
        }
      }
      
      return tasks;
    },
  };
}

// ============================================
// Store Factory
// ============================================

let store: TaskStore | null = null;

export async function getStore(): Promise<TaskStore> {
  if (store) return store;
  
  // Check if we're in Vercel with KV configured
  const isVercel = process.env.VERCEL === '1';
  const hasKV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
  
  if (isVercel && hasKV) {
    console.log('[Store] Using Vercel KV');
    try {
      store = await createKVStore();
    } catch (error) {
      console.warn('[Store] Failed to initialize KV, falling back to memory:', error);
      store = inMemoryStore;
    }
  } else {
    console.log('[Store] Using in-memory store');
    store = inMemoryStore;
  }
  
  return store;
}

// Convenience exports
export async function getTask(id: string): Promise<TaskSession | null> {
  const s = await getStore();
  return s.get(id);
}

export async function setTask(id: string, task: TaskSession): Promise<void> {
  const s = await getStore();
  return s.set(id, task);
}

export async function deleteTask(id: string): Promise<boolean> {
  const s = await getStore();
  return s.delete(id);
}

export async function listTasks(): Promise<TaskSession[]> {
  const s = await getStore();
  return s.list();
}

// Conversation to Task mapping (for webhooks)
const conversationMap = new Map<string, string>();

export function registerConversation(conversationId: string, taskId: string): void {
  conversationMap.set(conversationId, taskId);
}

export function getTaskIdForConversation(conversationId: string): string | undefined {
  return conversationMap.get(conversationId);
}

export function clearConversation(conversationId: string): void {
  conversationMap.delete(conversationId);
}

