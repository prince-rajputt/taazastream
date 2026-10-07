import { formatBitrate, formatBytes, type ActiveStream, type AdminStats } from '@taazastream/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Clapperboard, Cpu, Film, HardDrive, MemoryStick, Network, RefreshCw, ScanLine, Tv, Users, Wifi } from 'lucide-react';
import { Link } from 'react-router';
import { Spinner } from '../components/States';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { AdminHeader } from './AdminApp';
import { Badge, Button, Card, ErrorText, Meter, Sparkline, StatCard } from './ui';

export function useStats() {
  return useQuery({ queryKey: ['admin-stats'], queryFn: () => api.get<AdminStats>('/api/admin/stats'), refetchInterval: 3000 });
}

export function ScanPanel({ stats }: { stats: AdminStats }) {
  const qc = useQueryClient();
  const scan = useMutation({
    mutationFn: (full: boolean) => api.post('/api/admin/scan', { full }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-stats'] }),
  });
  const cancel = useMutation({ mutationFn: () => api.post('/api/admin/scan/cancel') });
  const job = stats.lastScan;
  const running = job?.status === 'running' || job?.status === 'queued';
  return (
    <Card
      title="Library scan"
      action={
        running ? (
          <Button size="sm" variant="danger" onClick={() => cancel.mutate()}>
            Cancel
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => scan.mutate(true)} disabled={scan.isPending} title="Re-read metadata of every file">
              <RefreshCw className="h-4 w-4" /> Full rescan
            </Button>
            <Button size="sm" variant="primary" onClick={() => scan.mutate(false)} disabled={scan.isPending}>
              <ScanLine className="h-4 w-4" /> Scan library
            </Button>
          </div>
        )
      }
    >
      <ErrorText error={scan.error} />
      {job ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={job.status === 'completed' ? 'ok' : job.status === 'failed' ? 'bad' : running ? 'brand' : 'warn'}>{job.status}</Badge>
            <span className="text-muted">{running ? 'Started' : 'Finished'} {timeAgo(running ? job.startedAt : job.finishedAt)}</span>
          </div>
          {running && (
            <>
              <Meter value={job.progress} />
              <p className="truncate font-mono text-xs text-faint">{job.currentFile ?? 'Walking folders…'}</p>
            </>
          )}
          <dl className="grid grid-cols-3 gap-3 text-center sm:grid-cols-5">
            {[
              ['Seen', job.filesSeen],
              ['Added', job.filesAdded],
              ['Updated', job.filesUpdated],
              ['Removed', job.filesRemoved],
              ['Failed', job.filesFailed],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-white/5 py-2">
                <dt className="text-[0.65rem] tracking-wide text-faint uppercase">{k}</dt>
                <dd className="font-display text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {job.message && <p className="text-xs text-muted">{job.message}</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">
          No scans yet. <Link to="/admin/folders" className="text-brand-300 underline-offset-2 hover:underline">Add a media folder</Link> and scan to build your library.
        </p>
      )}
    </Card>
  );
}

function StreamsTable({ streams }: { streams: ActiveStream[] }) {
  if (!streams.length) return <p className="text-sm text-muted">Nobody is watching right now.</p>;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm">
        <thead className="text-xs text-faint uppercase">
          <tr>
            <th className="px-2 py-2 font-medium">Title</th>
            <th className="px-2 py-2 font-medium">Device</th>
            <th className="px-2 py-2 font-medium">Mode</th>
            <th className="px-2 py-2 text-right font-medium">Bandwidth</th>
          </tr>
        </thead>
        <tbody>
          {streams.map((s) => (
            <tr key={s.id} className="border-t border-line">
              <td className="max-w-56 truncate px-2 py-2.5">{s.title}</td>
              <td className="px-2 py-2.5 text-muted">
                {s.deviceType} · {s.ip}
              </td>
              <td className="px-2 py-2.5">
                <Badge tone={s.mode === 'direct' ? 'ok' : s.mode === 'remux' ? 'brand' : 'warn'}>
                  {s.mode}
                  {s.mode === 'transcode' ? ` ${s.quality}` : ''}
                </Badge>
              </td>
              <td className="px-2 py-2.5 text-right font-mono text-xs tabular-nums">{formatBitrate(s.bandwidthBps)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DashboardPage() {
  const { data: s, error } = useStats();
  const { data: streams = [] } = useQuery({ queryKey: ['admin-streams'], queryFn: () => api.get<ActiveStream[]>('/api/admin/streams'), refetchInterval: 3000 });
  const { data: server } = useQuery({ queryKey: ['admin-server'], queryFn: () => api.get<AdminStats['server'] & { qrSvg: string }>('/api/admin/server'), staleTime: 60_000 });

  if (error) return <ErrorText error={error} />;
  if (!s) return <div className="flex justify-center py-20"><Spinner /></div>;

  const memFrac = s.system.memUsedBytes / s.system.memTotalBytes;
  const libraryDisk = s.storage.disks[0];
  const totalFree = s.storage.disks.reduce((n, d) => n + d.freeBytes, 0);

  return (
    <div className="space-y-6">
      <AdminHeader title="Dashboard" description={`${s.server.name} · up ${Math.floor(s.server.uptimeSec / 3600)}h ${Math.floor((s.server.uptimeSec % 3600) / 60)}m`} />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <StatCard label="Movies" value={s.counts.movies} icon={<Film className="h-4 w-4" />} />
        <StatCard label="Series" value={s.counts.series} icon={<Tv className="h-4 w-4" />} hint={`${s.counts.seasons} seasons`} />
        <StatCard label="Episodes" value={s.counts.episodes} icon={<Clapperboard className="h-4 w-4" />} />
        <StatCard label="Videos" value={s.counts.videos} hint={s.counts.missingVideos ? `${s.counts.missingVideos} missing on disk` : 'all present'} tone={s.counts.missingVideos ? 'warn' : 'ok'} icon={<Film className="h-4 w-4" />} />
        <StatCard label="Storage used" value={formatBytes(s.storage.libraryBytes)} hint={`HLS cache ${formatBytes(s.storage.cacheBytes)}`} icon={<HardDrive className="h-4 w-4" />} />
        <StatCard label="Storage available" value={formatBytes(totalFree)} hint={libraryDisk ? `${libraryDisk.path} ${Math.round((libraryDisk.usedBytes / libraryDisk.totalBytes) * 100)}% full` : undefined} icon={<HardDrive className="h-4 w-4" />} tone={libraryDisk && libraryDisk.freeBytes / libraryDisk.totalBytes < 0.05 ? 'bad' : undefined} />
        <StatCard label="Active streams" value={`${s.streams.active}/${s.streams.max}`} hint={`${s.streams.transcodes}/${s.streams.maxTranscodes} transcoding`} icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Connected devices" value={s.devices.connected} icon={<Users className="h-4 w-4" />} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><Cpu className="h-4 w-4 text-brand-400" /> CPU</span>}>
          <p className="font-display text-3xl font-semibold tabular-nums">{s.system.cpuPercent.toFixed(0)}%</p>
          <div className="mt-3"><Meter value={s.system.cpuPercent / 100} tone="auto" /></div>
          <p className="mt-2 truncate text-xs text-faint">{s.system.cpuCount} cores · {s.system.cpuModel}</p>
        </Card>
        <Card title={<span className="flex items-center gap-2"><MemoryStick className="h-4 w-4 text-brand-400" /> RAM</span>}>
          <p className="font-display text-3xl font-semibold tabular-nums">{Math.round(memFrac * 100)}%</p>
          <div className="mt-3"><Meter value={memFrac} tone="auto" /></div>
          <p className="mt-2 text-xs text-faint">
            {formatBytes(s.system.memUsedBytes)} of {formatBytes(s.system.memTotalBytes)} · TaazaStream {formatBytes(s.system.processRssBytes)}
          </p>
        </Card>
        <Card title={<span className="flex items-center gap-2"><Network className="h-4 w-4 text-brand-400" /> Network out</span>}>
          <p className="font-display text-3xl font-semibold tabular-nums">{formatBitrate(s.network.currentBps)}</p>
          <Sparkline points={s.network.history.map((h) => h.bps)} label="Network throughput over the last few minutes" />
          <p className="text-xs text-faint">{formatBytes(s.network.totalBytesSent)} streamed since start</p>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <ScanPanel stats={s} />
          <Card title="Now streaming" action={<Link to="/admin/devices" className="text-xs text-muted hover:text-fg">All devices</Link>}>
            <StreamsTable streams={streams} />
          </Card>
        </div>
        <Card title={<span className="flex items-center gap-2"><Wifi className="h-4 w-4 text-brand-400" /> Server</span>}>
          <div className="flex flex-col gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
            {server?.qrSvg && (
              <div className="w-36 shrink-0 rounded-xl bg-white p-2 [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label={`QR code for ${s.server.primaryUrl}`} dangerouslySetInnerHTML={{ __html: server.qrSvg }} />
            )}
            <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-faint">Server name</dt>
              <dd className="truncate">{s.server.name}</dd>
              <dt className="text-faint">Local IP</dt>
              <dd className="font-mono">{s.server.lanAddresses[0] ?? '—'}</dd>
              <dt className="text-faint">Port</dt>
              <dd className="font-mono">{s.server.port}</dd>
              <dt className="text-faint">Local URL</dt>
              <dd className="font-mono break-all text-brand-300">{s.server.primaryUrl}</dd>
              {s.server.mdnsHost && (
                <>
                  <dt className="text-faint">mDNS</dt>
                  <dd className="font-mono break-all">{s.server.mdnsHost}</dd>
                </>
              )}
              <dt className="text-faint">Connected</dt>
              <dd>{s.devices.connected} device{s.devices.connected === 1 ? '' : 's'}</dd>
              <dt className="text-faint">Active streams</dt>
              <dd>{s.streams.active}</dd>
              <dt className="text-faint">FFmpeg</dt>
              <dd>
                {s.server.ffmpeg.available ? <Badge tone="ok">{s.server.ffmpeg.source} {s.server.ffmpeg.version?.split('-')[0]}</Badge> : <Badge tone="bad">not found</Badge>}
              </dd>
              <dt className="text-faint">Cloud</dt>
              <dd>
                <Badge tone={s.server.cloud.mode === 'cloud-sync' ? 'ok' : 'neutral'}>{s.server.cloud.mode}</Badge>
              </dd>
            </dl>
          </div>
          {s.server.urls.length > 1 && <p className="mt-4 text-xs text-faint">Also reachable at {s.server.urls.slice(1).join(', ')}</p>}
        </Card>
      </div>
    </div>
  );
}
