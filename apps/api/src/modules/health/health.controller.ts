import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'kysely';
import { DATABASE, type Database } from '../../common/db/database';
import { AppError } from '../../common/errors/app-error';
import { RealtimeBus } from '../../common/realtime/realtime-bus';

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database, private readonly bus: RealtimeBus) {}

  /** Liveness: the process is up. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. */
  @Get('ready')
  async ready() {
    try {
      await sql`SELECT 1`.execute(this.db);
    } catch {
      throw new AppError('INTERNAL', 'database unavailable');
    }
    let redis: string;
    try {
      redis = await this.bus.ping();
    } catch {
      throw new AppError('INTERNAL', 'redis unavailable');
    }
    return { status: 'ok', checks: { database: 'ok', redis } };
  }
}
