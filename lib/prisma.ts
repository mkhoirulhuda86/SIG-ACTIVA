require('dotenv').config();
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const { Pool } = pg;

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL env variable is not set');
}

const defaultPoolMax = process.env.NODE_ENV === 'production' ? 5 : 20;
const poolMax = toPositiveInt(process.env.DB_POOL_MAX, defaultPoolMax);
const poolIdleTimeout = toPositiveInt(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30_000);
const poolConnectionTimeout = toPositiveInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 5_000);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  idleTimeoutMillis: poolIdleTimeout,
  connectionTimeoutMillis: poolConnectionTimeout,
});

const adapter = new PrismaPg(pool as unknown as ConstructorParameters<typeof PrismaPg>[0]);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
}; 

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
