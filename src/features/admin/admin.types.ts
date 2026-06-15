export interface AdminEventListItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  eventType: string;
  recurrence: string | null;
  startsAt: string | null;
  endsAt: string | null;
  city: string | null;
  venue: string | null;
  themeColor: string | null;
  capacity: number;
  ticketMode: string;
  createdAt: string;
  updatedAt: string;
  provider: {
    id: string | null;
    name: string | null;
    handle: string | null;
  } | null;
}

export interface AdminEventDetailItem extends AdminEventListItem {
  providerId: string | null;
  address: string | null;
  coverImageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  smokingAllowed: boolean;
  petFriendly: boolean;
  parkingAvailable: boolean;
  minAge: number | null;
}

export interface AdminEventListResponse {
  total: number;
  items: AdminEventListItem[];
}

export interface AdminEventActionResponse {
  ok: true;
  id: string;
  status: string;
}

export interface AdminOverviewMetricsResponse {
  activeEvents: number;
  totalEvents: number;
  tickets30d: number;
  posthogErrors30d: number | null;
  gmv30d: number | null;
}

export interface AdminPlatformStatusResponse {
  adminAuditLogsReady: boolean;
  paygate: {
    configured: boolean;
    connectivityStatus: string;
  };
  massSignupAlerts: {
    mode: 'cron';
    enabled: boolean;
    windowMinutes: number;
    threshold: number;
    cooldownMinutes: number;
    cron: string;
    recipientsConfigured: boolean;
    resendConfigured: boolean;
  };
}
