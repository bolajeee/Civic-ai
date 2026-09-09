import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Registers a `fastify.authenticate` decorator that can be used as a
 * `preHandler` on any route that requires a valid JWT.
 *
 * Usage:
 *   fastify.get('/protected', { preHandler: [fastify.authenticate] }, handler)
 */
async function authenticatePlugin(fastify: FastifyInstance) {
  fastify.decorate(
    'authenticate',
    async function (request: FastifyRequest, reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch (err) {
        reply.status(401).send({ error: 'Unauthorized' });
      }
    },
  );
}

export default fp(authenticatePlugin, { name: 'authenticate' });
