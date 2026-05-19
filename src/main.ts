import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
    // Prod: keep logs minimal (warn/error). Dev/stg: include log/debug.
    logger: isProd ? ['warn', 'error'] : ['log', 'debug', 'warn', 'error'],
  });
  // Ensure req.ip honors X-Forwarded-For behind proxies/load balancers.
  const instance = app.getHttpAdapter().getInstance();
  if (typeof instance?.set === 'function') {
    instance.set('trust proxy', 1);
  }
  app.enableCors();

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

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
