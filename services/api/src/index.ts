import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';

import authenticatePlugin from './plugins/authenticate';
import authRoutes from './routes/auth';
import govAuthRoutes from './routes/gov-auth';
import { uploadImage, getImageUrl } from './lib/storage';

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

fastify.register(fastifyMultipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Must be registered before any route that uses fastify.authenticate
fastify.register(authenticatePlugin);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(govAuthRoutes, { prefix: '/api/gov/auth' });

// Health check — no auth needed, safe to register inline
fastify.get('/api/health', async () => ({ status: 'ok' }));

// ---------------------------------------------------------------------------
// Protected routes
// Wrapped in fastify.register() so fastify.authenticate is fully loaded
// before these route definitions are evaluated.
// ---------------------------------------------------------------------------

fastify.register(async (app: FastifyInstance) => {
  app.post(
    '/api/test-upload',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ error: 'No file provided' });
      }

      try {
        const buffer = await data.toBuffer();
        const filename = `test-${Date.now()}-${data.filename}`;

        await uploadImage(filename, buffer, data.mimetype);
        const url = await getImageUrl(filename);

        return { success: true, filename, url };
      } catch (error: any) {
        app.log.error(error);
        return reply.status(500).send({ error: error.message });
      }
    },
  );
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
