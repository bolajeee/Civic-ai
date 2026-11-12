import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { locationSearchSchema } from '../schemas/geo';
import {
  searchLocations,
  GeoapifyConfigError,
  GeoapifyUpstreamError,
} from '../lib/geoapify';

export default async function geoRoutes(fastify: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // GET /api/geo/search — address/landmark search for the manual map picker.
  // Proxies Geoapify so the API key stays server-side and results stay
  // restricted to Nigeria; the citizen then fine-tunes the pin on the map.
  // ---------------------------------------------------------------------------
  fastify.get(
    '/search',
    { preHandler: [fastify.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { q, limit, lat, lon } = locationSearchSchema.parse(request.query);
        if ((lat === undefined) !== (lon === undefined)) {
          return reply.status(400).send({ error: 'lat and lon must be provided together' });
        }

        const results = await searchLocations({ q, limit, lat, lon });
        return reply.status(200).send({ results });
      } catch (err: any) {
        if (err.name === 'ZodError') return reply.status(400).send({ error: err.issues });
        if (err instanceof GeoapifyUpstreamError) {
          fastify.log.error(err);
          return reply.status(503).send({ error: 'Location search is temporarily unavailable' });
        }
        if (err instanceof GeoapifyConfigError) {
          fastify.log.error(err);
          return reply.status(500).send({ error: 'Internal Server Error' });
        }
        fastify.log.error(err);
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
