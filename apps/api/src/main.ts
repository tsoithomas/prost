import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

// Top-level route prefixes owned by the API. Anything else is treated as a client-side
// SPA route and falls back to index.html (see serveSpa below).
const API_ROUTE_PREFIXES = ['auth', 'connections', 'preferences', 'llm-endpoints', 'snippets', 'health'];

/**
 * When a built frontend bundle is present (production container), serve it from the same
 * origin as the API: static assets plus an index.html fallback for client-side routes.
 * The SPA is built with `VITE_API_URL=""`, so it calls the API with same-origin relative
 * paths and no CORS is involved. In local dev this directory does not exist and the block
 * is skipped — Vite serves the frontend on its own port instead.
 */
function serveSpa(app: NestExpressApplication): void {
  const webDist = process.env.WEB_DIST_PATH ?? join(__dirname, '..', '..', 'web', 'dist');
  if (!existsSync(join(webDist, 'index.html'))) {
    return;
  }

  app.useStaticAssets(webDist, { index: false });

  const indexHtml = join(webDist, 'index.html');
  const httpAdapter = app.getHttpAdapter().getInstance();
  httpAdapter.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    const path = req.path.replace(/^\/+/, '');
    const isApiRoute = API_ROUTE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    if (isApiRoute) {
      return next();
    }
    return res.sendFile(indexHtml);
  });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);
  const webOrigin = config.get<string>('WEB_ORIGIN') ?? 'http://localhost:5173';
  const allowedOrigins = webOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  app.enableCors({ origin: allowedOrigins });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  serveSpa(app);
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}

void bootstrap();
