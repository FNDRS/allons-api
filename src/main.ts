import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true keeps the original request bytes available on
  // RawBodyRequest<Request>.rawBody. Required by the Paygate webhook
  // controller to verify the HMAC signature against the exact bytes
  // Paygate signed (re-serializing JSON would produce a different
  // payload and break the signature check).
  const app = await NestFactory.create(AppModule, { rawBody: true });
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
      'Pagos con Paygate (Clinpays): iniciar checkout, consultar órdenes. Requiere JWT Supabase.',
    )
    .addTag('paygate', 'Diagnóstico de conectividad con la pasarela.')
    .addTag(
      'webhooks',
      'Endpoints públicos llamados por proveedores externos (p. ej. Paygate). No usan Bearer JWT del usuario.',
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
