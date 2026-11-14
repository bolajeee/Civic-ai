import type { FastifyInstance } from 'fastify';
import { query } from '../db';
import { governmentAccess } from './gov-access';

/** Reference list of Nigerian states for invite forms and state-aware map views. */
export default async function govStatesRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [app.authenticate, governmentAccess(app)] }, async (_request, reply) => {
    try {
      const result = await query<{
        id: string; code: string; name: string;
        west: number; south: number; east: number; north: number;
      }>(`SELECT id, code, name,
            ST_XMin(geom) AS west, ST_YMin(geom) AS south,
            ST_XMax(geom) AS east, ST_YMax(geom) AS north
          FROM nigeria_states ORDER BY name`);
      return {
        states: result.rows.map(row => ({
          id: row.id, code: row.code, name: row.name,
          bbox: [row.west, row.south, row.east, row.north],
        })),
      };
    } catch (error) {
      app.log.error(error);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
