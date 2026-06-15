import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the original request bytes available on
  // RawBodyRequest<Request>.rawBody. Required by the Paygate webhook
  // controller to verify the HMAC signature against the exact bytes
  // Paygate signed (re-serializing JSON would produce a different
  // payload and break the signature check).
  const isProd = (process.env.NODE_ENV ?? '').toLowerCase() === 'production';
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    // Prod: keep debug off, but keep transaction logs (log/warn/error).
    logger: isProd
      ? ['log', 'warn', 'error']
      : ['log', 'debug', 'warn', 'error'],
  });
  // Ensure req.ip honors X-Forwarded-For behind proxies/load balancers.
  const instance = app.getHttpAdapter().getInstance();
  if (typeof instance?.set === 'function') {
    instance.set('trust proxy', 1);
  }

  // Security headers. CSP is disabled because this service serves JSON (and,
  // in non-prod, the Swagger UI which would otherwise be blocked by the
  // default CSP); the other helmet defaults (HSTS, noSniff, frameguard) apply.
  app.use(helmet({ contentSecurityPolicy: false }));

  // CORS allow-list. Set CORS_ALLOWED_ORIGINS (comma-separated) in production
  // to the admin web + mobile web origins. When unset, the request origin is
  // reflected (legacy behavior) so non-prod and native clients keep working.
  const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsAllowedOrigins.length ? corsAllowedOrigins : true,
    credentials: false,
  });

  // Global input validation. `whitelist` strips properties without a
  // validation decorator; `forbidNonWhitelisted` rejects unexpected fields
  // (over-posting); `transform` instantiates the DTO class. Handlers typed
  // with plain objects/interfaces are unaffected (no class metadata).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger is exposed only outside production to avoid publishing the full
  // API surface (and pre-fillable auth) on the public deployment.
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('Allons API')
      .setDescription('Allons backend (NestJS + Prisma + Supabase Postgres)')
      .setVersion('0.0.1')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        'bearer',
      )
      .addSecurityRequirements('bearer')
      .addTag(
        'me — payments',
        'Paygate (Clinpays): start checkout, query orders. Requires Supabase JWT.',
      )
      .addTag('paygate', 'Gateway connectivity diagnostics.')
      .addTag(
        'webhooks',
        'Public endpoints called by external providers (e.g. Paygate). They do not use the user Bearer JWT.',
      )
      .build();
    const document = SwaggerModule.createDocument(app, config);

    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        // Enable "Try it out" by default.
        tryItOutEnabled: true,
        ...(process.env.SWAGGER_BEARER_TOKEN
          ? {
              // Optional: pre-fill auth if SWAGGER_BEARER_TOKEN is set.
              authAction: {
                bearer: {
                  name: 'bearer',
                  schema: {
                    type: 'http',
                    in: 'header',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                  },
                  value: `Bearer ${process.env.SWAGGER_BEARER_TOKEN}`,
                },
              },
            }
          : {}),
      },
    });
  }

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
