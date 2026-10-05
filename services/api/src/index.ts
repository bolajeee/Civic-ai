import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';

import authenticatePlugin from './plugins/authenticate';
import authRoutes from './routes/auth';
import govAuthRoutes from './routes/gov-auth';
import reportRoutes from './routes/reports';
import { uploadImage, getImageUrl } from './lib/storage';
import { startClassificationWorker } from './ai/classification_worker';
import { isClassificationEnabled } from './ai/classification';
import { startEmbeddingWorker } from './ai/embedding_worker';
import { isEmbeddingEnabled } from './ai/embedding';
import { backfillAiJobs } from './ai/backfill';
import { startDuplicateWorker } from './ai/duplicate_worker';
import { isDuplicateDetectionEnabled } from './ai/duplicates';
import { startClusteringWorker } from './ai/clustering_worker';
import { isClusteringEnabled } from './ai/clustering';
import { startSeverityWorker } from './ai/severity_worker';
import { isSeverityEnabled } from './ai/severity';
import { startPriorityWorker } from './ai/priority_worker';
import { isPriorityEnabled } from './ai/priority';
import govPriorityRoutes from './routes/gov-priority';
import govDashboardRoutes from './routes/gov-dashboard';

const fastify = Fastify({ logger: true });
let stopAIClassificationWorker = () => {};
let stopAIEmbeddingWorker = () => {};
let stopDuplicateWorker = () => {};
let stopClusteringWorker = () => {};
let stopSeverityWorker = () => {};
let stopPriorityWorker = () => {};

fastify.addHook('onClose', async () => {
  stopAIClassificationWorker();
  stopAIEmbeddingWorker();
  stopDuplicateWorker();
  stopClusteringWorker();
  stopSeverityWorker();
  stopPriorityWorker();
});

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
fastify.register(reportRoutes, { prefix: '/api/reports' });
fastify.register(govPriorityRoutes, { prefix: '/api/gov/issue-clusters' });
fastify.register(govDashboardRoutes, { prefix: '/api/gov/dashboard' });

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
    await backfillAiJobs(fastify.log);
    stopAIClassificationWorker = startClassificationWorker(fastify.log);
    stopSeverityWorker = startSeverityWorker(fastify.log);
    stopPriorityWorker = startPriorityWorker(fastify.log);
    fastify.log.info({ enabled: isPriorityEnabled() }, 'Cluster priority worker configuration');
    fastify.log.info({ enabled: isSeverityEnabled() }, 'AI severity worker configuration');
    fastify.log.info(
      { enabled: isClassificationEnabled() },
      'AI image classification worker configuration',
    );
    stopAIEmbeddingWorker = startEmbeddingWorker(fastify.log);
    fastify.log.info(
      { enabled: isEmbeddingEnabled() },
      'AI embedding worker configuration',
    );
    stopDuplicateWorker = startDuplicateWorker(fastify.log);
    stopClusteringWorker = startClusteringWorker(fastify.log);
    fastify.log.info(
      { enabled: isClusteringEnabled() },
      'Issue clustering worker configuration',
    );
    fastify.log.info(
      { enabled: isDuplicateDetectionEnabled() },
      'Duplicate detection worker configuration',
    );
    console.log(`Server listening at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
