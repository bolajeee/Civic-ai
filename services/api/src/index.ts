import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import dotenv from 'dotenv';

import authenticatePlugin from './plugins/authenticate';
import authRoutes from './routes/auth';
import govAuthRoutes from './routes/gov-auth';

dotenv.config();

const fastify = Fastify({ logger: true });

// ---------------------------------------------------------------------------
// Core plugins
// ---------------------------------------------------------------------------

fastify.register(cors, {
  origin: '*', // Tighten in production
});

fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'supersecretcivicaikey2026',
});

// Registers fastify.authenticate decorator — must come after JWT plugin
fastify.register(authenticatePlugin);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Citizen auth  →  /api/auth/*
fastify.register(authRoutes, { prefix: '/api/auth' });

// Government auth  →  /api/gov/auth/*
fastify.register(govAuthRoutes, { prefix: '/api/gov/auth' });

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

fastify.get('/api/health', async () => ({ status: 'ok' }));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
