import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import authRoutes from './routes/auth';

const fastify = Fastify({
  logger: true,
});

// Configure CORS
fastify.register(cors, {
  origin: '*', // For development, allow all. Update for production.
});

// Configure JWT
fastify.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'supersecretcivicaikey2026',
});

// Register routes
fastify.register(authRoutes, { prefix: '/api/auth' });

// Health check endpoint
fastify.get('/api/health', async () => {
  return { status: 'ok' };
});

const start = async () => {
  try {
    const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
