import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyMultipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';

import authenticatePlugin from './plugins/authenticate';
import authRoutes from './routes/auth';
import govAuthRoutes from './routes/gov-auth';
import reportRoutes from './routes/reports';
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
import govMapRoutes from './routes/gov-map';
import govReportsRoutes from './routes/gov-reports';
import govClustersRoutes from './routes/gov-clusters';
import govClusterActionRoutes from './routes/gov-cluster-actions';
import govAdminRoutes from './routes/gov-admin';
import observabilityRoutes from './routes/observability';
import notificationRoutes from './routes/notifications';
import { startPushWorker } from './notifications/push_worker';
import { isPushDeliveryEnabled } from './lib/firebase-push';
import { startVisualEmbeddingWorker } from './ai/visual_embedding_worker';
import { isVisualEmbeddingEnabled } from './ai/visual_embedding';
import { pool } from './db';

// Set TRUST_PROXY=true behind a reverse proxy so request.ip (used by rate
// limiting) is the client address rather than the proxy's.
const fastify = Fastify({
  logger: {
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'request.headers.authorization',
        'request.headers.cookie',
      ],
      censor: '[REDACTED]',
    },
  },
  trustProxy: process.env.TRUST_PROXY === 'true',
});
let stopAIClassificationWorker = () => {};
let stopAIEmbeddingWorker = () => {};
let stopVisualEmbeddingWorker = () => {};
let stopDuplicateWorker = () => {};
let stopClusteringWorker = () => {};
let stopSeverityWorker = () => {};
let stopPriorityWorker = () => {};
let stopPushWorker = () => {};

fastify.addHook('onClose', async () => {
  stopAIClassificationWorker();
  stopAIEmbeddingWorker();
  stopVisualEmbeddingWorker();
  stopDuplicateWorker();
  stopClusteringWorker();
  stopSeverityWorker();
  stopPriorityWorker();
  stopPushWorker();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Core plugins
// ---------------------------------------------------------------------------

const isProduction = process.env.NODE_ENV === 'production';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProduction) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
  fastify.log.warn('JWT_SECRET is not set; using an insecure development default');
  return 'supersecretcivicaikey2026';
}

// CORS_ORIGINS is a comma-separated allowlist (e.g. the government dashboard
// origin). The mobile app is not a browser and is unaffected. Unset means
// any origin in development and no cross-origin access in production.
const corsOrigins = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

fastify.register(cors, {
  origin: corsOrigins.length > 0 ? corsOrigins : !isProduction,
});

// Credential endpoints get a much tighter budget than the rest of the API.
fastify.register(rateLimit, {
  max: (request) =>
    request.url.startsWith('/api/auth') || request.url.startsWith('/api/gov/auth') ? 30 : 300,
  timeWindow: '1 minute',
});

fastify.register(fastifyJwt, {
  secret: resolveJwtSecret(),
});

fastify.register(fastifyMultipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Must be registered before any route that uses fastify.authenticate
fastify.register(authenticatePlugin);
fastify.register(observabilityRoutes);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(govAuthRoutes, { prefix: '/api/gov/auth' });
fastify.register(reportRoutes, { prefix: '/api/reports' });
fastify.register(notificationRoutes, { prefix: '/api/notifications' });
fastify.register(govPriorityRoutes, { prefix: '/api/gov/issue-clusters' });
fastify.register(govDashboardRoutes, { prefix: '/api/gov/dashboard' });
fastify.register(govMapRoutes, { prefix: '/api/gov/dashboard' });
fastify.register(govReportsRoutes, { prefix: '/api/gov/reports' });
fastify.register(govClustersRoutes, { prefix: '/api/gov/issue-clusters' });
fastify.register(govClusterActionRoutes, { prefix: '/api/gov/issue-clusters' });
fastify.register(govAdminRoutes, { prefix: '/api/gov/admin' });

// Return consistent JSON errors and keep internals out of 5xx responses.
fastify.setErrorHandler((error: any, request, reply) => {
  const statusCode =
    typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500;
  if (statusCode >= 500) {
    request.log.error(error);
    return reply.status(statusCode).send({ error: 'Internal server error' });
  }
  return reply.status(statusCode).send({ error: error.message });
});

fastify.setNotFoundHandler((_request, reply) => {
  reply.status(404).send({ error: 'Not found' });
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
    stopPushWorker = startPushWorker(fastify.log);
    fastify.log.info({ enabled: isPushDeliveryEnabled() }, 'Citizen push worker configuration');
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
    stopVisualEmbeddingWorker = startVisualEmbeddingWorker(fastify.log);
    fastify.log.info(
      { enabled: isVisualEmbeddingEnabled() },
      'AI visual embedding worker configuration',
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

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  fastify.log.info({ signal }, 'Graceful shutdown started');
  try {
    await fastify.close();
    process.exit(0);
  } catch (error) {
    fastify.log.error({ err: error }, 'Graceful shutdown failed');
    process.exit(1);
  }
};

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

start();
