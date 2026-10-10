import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DATABASE, type Database } from '../db/database';

interface Job {
  name: string;
  everySeconds: number;
  run: () => Promise<void>;
}

/**
 * Periodic background jobs (TECH §22). Each run takes a Postgres advisory lock keyed by job name, so with N instances
 * exactly one executes a given job at a time. Jobs must be idempotent.
 */
@Injectable()
export class JobScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(JobScheduler.name);
  private readonly jobs: Job[] = [];
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  register(name: string, everySeconds: number, run: () => Promise<void>): void {
    this.jobs.push({ name, everySeconds, run });
  }

  /** Runs a job now (tests, admin "run now"). Returns false when another instance holds the lock. */
  async runNow(name: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.name === name);
    if (!job) throw new Error(`unknown job ${name}`);
    return this.execute(job);
  }

  onApplicationBootstrap(): void {
    if (!this.cfg.WORKERS_ENABLED) return;
    for (const job of this.jobs) {
      const t = setInterval(() => void this.execute(job), job.everySeconds * 1000);
      t.unref();
      this.timers.push(t);
    }
  }

  onApplicationShutdown(): void {
    this.timers.forEach(clearInterval);
  }

  private async execute(job: Job): Promise<boolean> {
    const key = createHash('sha256').update(`job:${job.name}`).digest().readBigInt64BE(0);
    return this.db.connection().execute(async (conn) => {
      const { rows } = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(${key}) AS locked`.execute(conn);
      if (!rows[0]?.locked) return false;
      try {
        await job.run();
      } catch (err) {
        this.logger.error(`job ${job.name} failed: ${(err as Error).message}`);
      } finally {
        await sql`SELECT pg_advisory_unlock(${key})`.execute(conn);
      }
      return true;
    });
  }
}
