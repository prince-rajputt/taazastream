import { formatBytes, type BackupInfo, type CloudStatus } from '@taazastream/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, CloudOff, Download, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Spinner } from '../components/States';
import { api } from '../lib/api';
import { timeAgo } from '../lib/format';
import { AdminHeader } from './AdminApp';
import { Badge, Button, Card, ErrorText } from './ui';

export default function BackupsPage() {
  const qc = useQueryClient();
  const { data: backups, isLoading } = useQuery({ queryKey: ['admin-backups'], queryFn: () => api.get<BackupInfo[]>('/api/admin/backups') });
  const { data: cloud } = useQuery({ queryKey: ['admin-cloud'], queryFn: () => api.get<CloudStatus>('/api/admin/cloud') });
  const create = useMutation({ mutationFn: () => api.post('/api/admin/backups'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-backups'] }) });
  const remove = useMutation({ mutationFn: (f: string) => api.delete(`/api/admin/backups/${f}`), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-backups'] }) });
  const check = useMutation({ mutationFn: () => api.post<CloudStatus>('/api/admin/cloud/check'), onSuccess: (s) => qc.setQueryData(['admin-cloud'], s) });
  const sync = useMutation({ mutationFn: () => api.post<{ ok: boolean; message: string }>('/api/admin/cloud/sync'), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-cloud'] }) });

  return (
    <div className="space-y-6">
      <AdminHeader title="Backup & cloud" description="Back up the database, metadata and settings. Video files are never included — back those up separately (see README)." />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card
          title="Local backups"
          action={
            <Button variant="primary" size="sm" onClick={() => create.mutate()} disabled={create.isPending}>
              <Save className="h-4 w-4" /> {create.isPending ? 'Backing up…' : 'Back up now'}
            </Button>
          }
        >
          <ErrorText error={create.error ?? remove.error} />
          {isLoading ? (
            <Spinner className="mx-auto h-8 w-8" />
          ) : !backups?.length ? (
            <p className="text-sm text-muted">No backups yet. The 10 most recent backups are kept in the server’s backups folder.</p>
          ) : (
            <ul className="divide-y divide-line">
              {backups.map((b) => (
                <li key={b.fileName} className="flex items-center gap-3 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{b.fileName}</p>
                    <p className="text-xs text-faint">
                      {b.fileName.endsWith('.db') ? 'SQLite database' : 'Metadata & settings (JSON)'} · {formatBytes(b.sizeBytes)} · {timeAgo(b.createdAt)}
                    </p>
                  </div>
                  <a href={`/api/admin/backups/${b.fileName}`} download className="inline-flex h-8 items-center gap-1 rounded-lg border border-line-strong px-3 text-xs hover:bg-white/10">
                    <Download className="h-3.5 w-3.5" /> Download
                  </a>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${b.fileName}`} onClick={() => confirm(`Delete ${b.fileName}?`) && remove.mutate(b.fileName)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-4 text-xs leading-relaxed text-faint">
            To restore: stop TaazaStream, copy a <span className="font-mono">.db</span> backup over <span className="font-mono">data\taazastream.db</span>, then start it again.
          </p>
        </Card>

        <Card title={<span className="flex items-center gap-2">{cloud?.reachable ? <Cloud className="h-4 w-4 text-ok" /> : <CloudOff className="h-4 w-4 text-faint" />} Supabase (optional)</span>}>
          {cloud ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge tone={cloud.configured ? 'ok' : 'neutral'}>{cloud.configured ? 'configured' : 'not configured'}</Badge>
                <Badge tone={cloud.reachable ? 'ok' : 'warn'}>{cloud.reachable ? 'reachable' : 'offline'}</Badge>
                <Badge tone={cloud.canWrite ? 'ok' : 'neutral'}>{cloud.canWrite ? 'sync enabled' : 'read-only'}</Badge>
                <Badge tone="brand">{cloud.mode}</Badge>
              </div>
              <p className="text-muted">{cloud.message}</p>
              <p className="text-xs text-faint">
                Last check {timeAgo(cloud.lastCheckedAt)} · last sync {timeAgo(cloud.lastSyncAt)}
              </p>
              <p className="rounded-lg border border-line bg-ink p-3 text-xs leading-relaxed text-muted">
                Cloud sync copies titles, artwork and a metadata backup to your Supabase project. Playback, search and the admin panel never depend on it —
                TaazaStream keeps working when the internet is down.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => check.mutate()} disabled={!cloud.configured || check.isPending}>
                  <RefreshCw className="h-3.5 w-3.5" /> Check connection
                </Button>
                <Button size="sm" variant="primary" onClick={() => sync.mutate()} disabled={!cloud.canWrite || sync.isPending}>
                  <Cloud className="h-3.5 w-3.5" /> {sync.isPending ? 'Syncing…' : 'Sync now'}
                </Button>
              </div>
              {sync.data && <p className={`text-sm ${sync.data.ok ? 'text-ok' : 'text-warn'}`}>{sync.data.message}</p>}
              <ErrorText error={sync.error ?? check.error} />
            </div>
          ) : (
            <Spinner className="mx-auto h-8 w-8" />
          )}
        </Card>
      </div>
    </div>
  );
}
