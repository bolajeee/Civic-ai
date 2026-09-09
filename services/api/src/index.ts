import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import dotenv from 'dotenv';
import fastifyMultipart from '@fastify/multipart';

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

// File upload support
fastify.register(fastifyMultipart, {
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
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
// Test Upload Route
// ---------------------------------------------------------------------------

import { uploadImage, getImageUrl } from './lib/storage';

fastify.post('/api/test-upload', { preHandler: [fastify.authenticate] }, async (request, reply) => {
  const data = await request.file();
  
  if (!data) {
    return reply.status(400).send({ error: 'No file provided' });
  }

  try {
    const buffer = await data.toBuffer();
    // Use a unique name for the test upload
    const filename = `test-${Date.now()}-${data.filename}`;
    
    await uploadImage(filename, buffer, data.mimetype);
    const url = await getImageUrl(filename);
    
    return { success: true, filename, url };
  } catch (error: any) {
    fastify.log.error(error);
    return reply.status(500).send({ error: error.message });
  }
});

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
