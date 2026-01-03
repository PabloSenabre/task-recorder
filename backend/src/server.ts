// ============================================
// Task Recorder Backend - Server Entry Point
// ============================================

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { taskRoutes } from './routes/tasks.js';
import { webhookRoutes } from './routes/webhook.js';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================
// Configuration
// ============================================

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

// ============================================
// Server Setup
// ============================================

const fastify = Fastify({
  logger: process.env.NODE_ENV === 'production' 
    ? { level: 'info' }
    : {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: {
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        },
      },
});

// Register CORS
await fastify.register(cors, {
  origin: true, // Allow all origins for development
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

// Serve static files from public directory
await fastify.register(fastifyStatic, {
  root: join(__dirname, '..', 'public'),
  prefix: '/', // Serve at root path
});

// Health check endpoint
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: Date.now() };
});

// Register task routes
await fastify.register(taskRoutes, { prefix: '/tasks' });

// Register webhook routes
await fastify.register(webhookRoutes, { prefix: '/webhook' });

// ============================================
// Error Handling
// ============================================

fastify.setErrorHandler((error, request, reply) => {
  fastify.log.error(error);
  
  reply.status(error.statusCode || 500).send({
    error: {
      message: error.message,
      code: error.code || 'INTERNAL_ERROR',
    },
  });
});

// ============================================
// Start Server
// ============================================

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`
╔════════════════════════════════════════════╗
║         Task Recorder Backend              ║
╠════════════════════════════════════════════╣
║  Server running at http://${HOST}:${PORT}        ║
║                                            ║
║  Endpoints:                                ║
║    GET  /health           - Health check   ║
║    POST /tasks            - Create task    ║
║    POST /tasks/:id/actions - Add actions   ║
║    POST /tasks/:id/stop   - Stop & generate║
║    GET  /tasks/:id        - Get task       ║
╚════════════════════════════════════════════╝
    `);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

// Graceful shutdown
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
for (const signal of signals) {
  process.on(signal, async () => {
    console.log(`\nReceived ${signal}, shutting down...`);
    await fastify.close();
    process.exit(0);
  });
}

