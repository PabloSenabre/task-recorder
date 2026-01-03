// ============================================
// Vercel Serverless Entry Point
// Adapts Fastify for Vercel's serverless environment
// ============================================

import 'dotenv/config';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { taskRoutes } from '../src/routes/tasks.js';
import { webhookRoutes } from '../src/routes/webhook.js';
import type { IncomingMessage, ServerResponse } from 'http';

// ============================================
// Build Fastify App
// ============================================

let app: FastifyInstance | null = null;

async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
    },
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Health check endpoint
  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: Date.now(), env: 'vercel' };
  });

  // Root endpoint
  fastify.get('/', async () => {
    return { 
      name: 'Task Recorder API',
      version: '1.0.0',
      status: 'running',
      endpoints: [
        'GET /health',
        'POST /tasks',
        'POST /tasks/:id/actions',
        'POST /tasks/:id/stop',
        'GET /tasks/:id',
        'POST /webhook/elevenlabs',
      ],
    };
  });

  // Register routes
  await fastify.register(taskRoutes, { prefix: '/tasks' });
  await fastify.register(webhookRoutes, { prefix: '/webhook' });

  // Error handler
  fastify.setErrorHandler((error, request, reply) => {
    fastify.log.error(error);
    reply.status(error.statusCode || 500).send({
      error: {
        message: error.message,
        code: error.code || 'INTERNAL_ERROR',
      },
    });
  });

  await fastify.ready();
  return fastify;
}

async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    app = await buildApp();
  }
  return app;
}

// ============================================
// Vercel Handler (using Fastify's inject for serverless)
// ============================================

export default async function handler(
  req: IncomingMessage & { url?: string; method?: string; body?: any },
  res: ServerResponse
) {
  const fastify = await getApp();
  
  // Build the request URL
  const url = req.url || '/';
  const method = req.method || 'GET';
  
  // Get headers as a plain object
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers[key] = value;
    } else if (Array.isArray(value)) {
      headers[key] = value.join(', ');
    }
  }

  // Read body for POST/PUT requests
  let body: string | undefined;
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    if (req.body) {
      // Vercel already parsed the body
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      // Read body from stream
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks).toString();
    }
  }

  // Use Fastify's inject method for serverless
  const response = await fastify.inject({
    method: method as any,
    url,
    headers,
    payload: body,
  });

  // Set response headers
  for (const [key, value] of Object.entries(response.headers)) {
    if (value !== undefined) {
      res.setHeader(key, value as string);
    }
  }

  // Set status and send body
  res.statusCode = response.statusCode;
  res.end(response.body);
}
