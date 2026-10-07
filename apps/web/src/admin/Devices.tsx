import { formatBitrate, formatBytes, type DeviceInfo } from '@taazastream/shared';
import { useQuery } from '@tanstack/react-query';
import { Laptop, Monitor, Smartphone, Tablet, Tv } from 'lucide-react';
import { Spinner } from '../components/States';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { AdminHeader } from './AdminApp';
import { Badge, Card, ErrorText } from './ui';

const ICONS = {
  Phone: Smartphone,
  Tablet: Tablet,
  Desktop: Laptop,
  TV: Tv,
  Unknown: Monitor,
} as const;

export default function DevicesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-devices'],
    queryFn: () => api.get<DeviceInfo[]>('/api/admin/devices'),
    refetchInterval: 3000,
  });
  return (
    <div className="space-y-6">
      <AdminHeader
        title="Devices"
        description="Devices that used TaazaStream in the last few minutes. Only the IP address and device type are kept, in memory."
      />
      <ErrorText error={error} />
      {isLoading ? (
        <Spinner className="mx-auto h-8 w-8" />
      ) : !data?.length ? (
        <Card>
          <p className="text-sm text-muted">
            No devices connected. Open the server address on a phone, laptop or TV on the same
            Wi-Fi.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.map((d) => {
            const Icon = ICONS[d.type];
            return (
              <Card key={d.id}>
                <div className="flex items-start gap-4">
                  <span
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${d.status === 'Streaming' ? 'bg-gradient-brand text-white' : 'bg-white/8 text-white/70'}`}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{d.type}</p>
                      <Badge tone={d.status === 'Streaming' ? 'ok' : 'neutral'}>{d.status}</Badge>
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      <dt className="text-faint">IP</dt>
                      <dd className="font-mono">{d.ip}</dd>
                      <dt className="text-faint">Browser</dt>
                      <dd>
                        {d.browser} on {d.os}
                      </dd>
                      <dt className="text-faint">Current video</dt>
                      <dd className="truncate">{d.currentVideo ?? '—'}</dd>
                      <dt className="text-faint">Bandwidth</dt>
                      <dd className="font-mono">{formatBitrate(d.bandwidthBps)}</dd>
                      <dt className="text-faint">Data sent</dt>
                      <dd>{formatBytes(d.bytesSent)}</dd>
                      <dt className="text-faint">Last seen</dt>
                      <dd>{timeAgo(d.lastSeen)}</dd>
                    </dl>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
