import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SupabaseAdminService } from '../src/supabase-admin.service';
import { InterestsService } from '../src/interests.service';
import { AccountService } from '../src/account.service';
import { MeService } from '../src/me/me.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let prismaMock: {
    provider: { findMany: jest.Mock };
    event: { findMany: jest.Mock };
  };
  let supabaseAdminMock: { getAuthenticatedUser: jest.Mock };

  beforeAll(async () => {
    prismaMock = {
      provider: { findMany: jest.fn() },
      event: { findMany: jest.fn() },
    };

    supabaseAdminMock = {
      getAuthenticatedUser: jest.fn((authorization?: string) => {
        if (authorization === 'Bearer test-token') {
          return {
            id: '00000000-0000-0000-0000-000000000001',
            email: 'test@allonsapp.com',
            user_metadata: { name: 'Test User' },
          };
        }
        throw new UnauthorizedException('Invalid token');
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(SupabaseAdminService)
      .useValue(supabaseAdminMock)
      .overrideProvider(InterestsService)
      .useValue({
        getUserInterestNames: jest.fn(() =>
          Promise.resolve(['Conciertos', 'Comidas']),
        ),
        replaceUserInterests: jest.fn(
          (_userId: string, _meta: any, names: string[]) =>
            Promise.resolve(names),
        ),
      })
      .overrideProvider(AccountService)
      .useValue({ deleteAccount: jest.fn(() => Promise.resolve(undefined)) })
      .overrideProvider(MeService)
      .useValue({
        getProfile: jest.fn(() =>
          Promise.resolve({
            userId: '00000000-0000-0000-0000-000000000001',
            email: 'test@allonsapp.com',
            fullName: 'Test User',
            username: 'testuser',
            avatarUrl: null,
            avatarColor: '#787878',
            location: 'CDMX',
            interests: ['Conciertos'],
          }),
        ),
        updateProfile: jest.fn(() => Promise.resolve({ ok: true })),
        listTickets: jest.fn(() => Promise.resolve([])),
        listConversations: jest.fn(() => Promise.resolve([])),
        listNotifications: jest.fn(() => Promise.resolve([])),
        listEventHistory: jest.fn(() => Promise.resolve([])),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('/health (GET)', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect({ ok: true });
  });

  it('/providers (GET)', async () => {
    prismaMock.provider.findMany.mockResolvedValueOnce([
      {
        id: 'p1',
        name: 'Allons Originals',
        handle: 'allons',
        createdAt: new Date().toISOString(),
      },
    ]);

    const res = await request(app.getHttpServer())
      .get('/providers')
      .expect(200);
    const body = res.body as Array<{ handle?: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]?.handle).toBe('allons');
  });

  it('/events (GET) returns all events', async () => {
    prismaMock.event.findMany.mockResolvedValueOnce([
      {
        id: 'e1',
        title: 'Event 1',
        city: 'CDMX',
        provider: { id: 'p1', handle: 'allons' },
      },
    ]);

    const res = await request(app.getHttpServer()).get('/events').expect(200);
    const body = res.body as Array<{ provider?: { handle?: string } }>;
    expect(body[0]?.provider?.handle).toBe('allons');
    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined }),
    );
  });

  it('/events?city=CDMX (GET) filters by city', async () => {
    prismaMock.event.findMany.mockResolvedValueOnce([]);

    await request(app.getHttpServer()).get('/events?city=CDMX').expect(200);
    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { city: 'CDMX' } }),
    );
  });

  it('/events/top (GET) returns top events', async () => {
    prismaMock.event.findMany.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get('/events/top').expect(200);
    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 }),
    );
  });

  it('/events/friends (GET) returns friends events', async () => {
    prismaMock.event.findMany.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get('/events/friends').expect(200);
    expect(prismaMock.event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 6 }),
    );
  });

  it('/me (GET) requires auth', async () => {
    await request(app.getHttpServer()).get('/me').expect(401);
  });

  it('/me (GET) returns profile when authenticated', async () => {
    const res = await request(app.getHttpServer())
      .get('/me')
      .set('authorization', 'Bearer test-token')
      .expect(200);
    const body = res.body as { userId?: string };
    expect(body.userId).toBe('00000000-0000-0000-0000-000000000001');
  });

  it('/me/interests (PUT) validates request body', async () => {
    await request(app.getHttpServer())
      .put('/me/interests')
      .set('authorization', 'Bearer test-token')
      .send({ interests: 'nope' })
      .expect(400);
  });

  it('/me/account (DELETE) requires auth', async () => {
    await request(app.getHttpServer()).delete('/me/account').expect(401);
  });

  afterAll(async () => {
    await app.close();
  });
});
