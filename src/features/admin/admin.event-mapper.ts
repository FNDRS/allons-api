import type { AdminEventDetailItem, AdminEventListItem } from './admin.types';

type EventRow = {
  id: string;
  providerId: string | null;
  title: string;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  city: string | null;
  venue: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  coverImageUrl: string | null;
  themeColor: string | null;
  smokingAllowed: boolean;
  petFriendly: boolean;
  parkingAvailable: boolean;
  minAge: number | null;
  eventType: string;
  recurrence: string | null;
  ticketMode: string;
  capacity: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  provider: {
    id: string;
    name: string;
    handle: string | null;
  } | null;
};

export function mapAdminEventListItem(e: EventRow): AdminEventListItem {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    status: e.status,
    eventType: e.eventType,
    recurrence: e.recurrence,
    startsAt: e.startsAt?.toISOString() ?? null,
    endsAt: e.endsAt?.toISOString() ?? null,
    city: e.city,
    venue: e.venue,
    themeColor: e.themeColor,
    capacity: e.capacity,
    ticketMode: e.ticketMode,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
    provider: e.provider
      ? {
          id: e.provider.id,
          name: e.provider.name,
          handle: e.provider.handle,
        }
      : null,
  };
}

export function mapAdminEventDetail(e: EventRow): AdminEventDetailItem {
  return {
    ...mapAdminEventListItem(e),
    providerId: e.providerId,
    address: e.address,
    coverImageUrl: e.coverImageUrl,
    latitude: e.latitude,
    longitude: e.longitude,
    smokingAllowed: e.smokingAllowed,
    petFriendly: e.petFriendly,
    parkingAvailable: e.parkingAvailable,
    minAge: e.minAge,
  };
}
