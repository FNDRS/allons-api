import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
