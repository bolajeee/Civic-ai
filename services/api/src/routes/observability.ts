import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { pool } from '../db';

const startedAt = Date.now();
const requestStartedAt = new WeakMap<FastifyRequest, bigint>();
let completedRequests = 0;
let failedRequests = 0;
let totalDurationSeconds = 0;

function authorized(header: string | undefined): boolean {
  const token = process.env.METRICS_TOKEN;
  if (!token || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function metricsText(): string {
  const memory = process.memoryUsage();
  return `${[
    '# HELP civicai_http_requests_total Completed HTTP requests.',
    '# TYPE civicai_http_requests_total counter',
    `civicai_http_requests_total ${completedRequests}`,
    '# HELP civicai_http_request_failures_total HTTP responses with status 500 or higher.',
    '# TYPE civicai_http_request_failures_total counter',
    `civicai_http_request_failures_total ${failedRequests}`,
    '# HELP civicai_http_request_duration_seconds_total Cumulative request duration.',
    '# TYPE civicai_http_request_duration_seconds_total counter',
    `civicai_http_request_duration_seconds_total ${totalDurationSeconds.toFixed(6)}`,
    '# HELP civicai_process_uptime_seconds Process uptime.',
    '# TYPE civicai_process_uptime_seconds gauge',
    `civicai_process_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(3)}`,
    '# HELP civicai_process_resident_memory_bytes Resident memory size.',
    '# TYPE civicai_process_resident_memory_bytes gauge',
    `civicai_process_resident_memory_bytes ${memory.rss}`,
  ].join('\n')}\n`;
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Readiness query timed out')),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function observabilityRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', async (request, reply) => {
    requestStartedAt.set(request, process.hrtime.bigint());
    reply.header('x-request-id', request.id);
  });

  fastify.addHook('onResponse', async (request, reply) => {
    const start = requestStartedAt.get(request);
    completedRequests++;
    if (reply.statusCode >= 500) failedRequests++;
    if (start != null) {
      totalDurationSeconds += Number(process.hrtime.bigint() - start) / 1e9;
    }
  });

  fastify.get('/api/health', async () => ({ status: 'ok' }));
  fastify.get('/api/health/live', async () => ({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }));
  fastify.get('/api/health/ready', async (_request, reply) => {
    try {
      await withTimeout(pool.query('SELECT 1'), 2000);
      return { status: 'ready', database: 'ok' };
    } catch (error) {
      fastify.log.error({ err: error }, 'Readiness check failed');
      return reply.status(503).send({ status: 'not_ready', database: 'unavailable' });
    }
  });

  fastify.get('/api/metrics', async (request, reply) => {
    if (!process.env.METRICS_TOKEN) {
      return reply.status(503).send({ error: 'Metrics are not configured' });
    }
    if (!authorized(request.headers.authorization)) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(metricsText());
  });
}

export default fp(observabilityRoutes, { name: 'observability' });
