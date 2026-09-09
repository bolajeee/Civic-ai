import { FastifyRequest, FastifyReply } from 'fastify';

// Extend Fastify's type definitions so TypeScript knows about custom decorators
declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
