import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import { query } from '../db';
import { registerSchema, loginSchema } from '../schemas/auth';
import crypto from 'crypto';

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post('/register', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsedBody = registerSchema.parse(request.body);
      
      const { email, password, phone } = parsedBody;

      // Check if user already exists
      const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
      if (existingUser.rows.length > 0) {
        return reply.status(400).send({ error: 'User with this email already exists' });
      }

      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);
      
      const publicId = crypto.randomUUID();

      const insertResult = await query(
        `INSERT INTO users (public_id, email, phone, password_hash, role) 
         VALUES ($1, $2, $3, $4, 'CITIZEN') RETURNING id, public_id, email, role`,
        [publicId, email, phone || null, passwordHash]
      );

      const user = insertResult.rows[0];

      const token = fastify.jwt.sign({ 
        id: user.id, 
        public_id: user.public_id,
        email: user.email, 
        role: user.role 
      });

      return reply.status(201).send({ token, user });

    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ error: err.errors });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  fastify.post('/login', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parsedBody = loginSchema.parse(request.body);
      
      const { email, password } = parsedBody;

      const userResult = await query('SELECT * FROM users WHERE email = $1', [email]);
      
      if (userResult.rows.length === 0) {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }

      const user = userResult.rows[0];

      const isPasswordValid = await bcrypt.compare(password, user.password_hash);

      if (!isPasswordValid) {
        return reply.status(401).send({ error: 'Invalid email or password' });
      }
      
      if (user.status !== 'ACTIVE') {
        return reply.status(403).send({ error: `Account is ${user.status.toLowerCase()}` });
      }

      const token = fastify.jwt.sign({ 
        id: user.id, 
        public_id: user.public_id,
        email: user.email, 
        role: user.role 
      });

      return reply.status(200).send({ 
        token, 
        user: { 
          id: user.id, 
          public_id: user.public_id,
          email: user.email, 
          role: user.role 
        } 
      });

    } catch (err: any) {
      if (err.name === 'ZodError') {
        return reply.status(400).send({ error: err.errors });
      }
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal Server Error' });
    }
  });
}
