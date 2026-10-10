import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { raw } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './common/config/config';
import { requestIdMiddleware } from './common/http/request-context';

/** Shared by main.ts and e2e tests so tests exercise the exact production middleware stack. */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    logger: config.NODE_ENV === 'test' ? ['error'] : ['log', 'warn', 'error'],
    bodyParser: true,
    rawBody: true, // payment webhooks verify signatures over the exact bytes received
  });
  app.useBodyParser('json', { limit: '256kb' });
  // Development disk storage receives raw upload bodies (S3 would receive them directly).
  if (config.S3_BUCKET === 'local') app.use('/v1/dev-storage/put', raw({ type: () => true, limit: '60mb' }));
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(requestIdMiddleware);
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Request-Id', 'Idempotency-Key'],
  });
  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready', 'metrics'] });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  if (config.NODE_ENV !== 'production' || config.API_DOCS_ENABLED) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('LOL API').setDescription('LOL — Lot of Love: dating and relationship platform API.').setVersion('1').addBearerAuth().addCookieAuth('amora_admin').build(),
    );
    SwaggerModule.setup('docs', app, doc);
  }
  return app;
}
