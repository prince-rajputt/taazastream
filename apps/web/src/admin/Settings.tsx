import { formatBytes, type AdminSettings, type ServerInfo } from '@taazastream/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Spinner } from '../components/States';
import { api } from '../lib/api';
import { looksLikeTv, usePrefs } from '../store/prefs';
import { AdminHeader } from './AdminApp';
import { Badge, Button, Card, ErrorText, Field, Input, Select, Toggle } from './ui';

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<AdminSettings>('/api/admin/settings') });
  const { data: server } = useQuery({ queryKey: ['admin-server'], queryFn: () => api.get<ServerInfo & { qrSvg: string }>('/api/admin/server') });
  const { data: cache, refetch: refetchCache } = useQuery({ queryKey: ['admin-cache'], queryFn: () => api.get<{ hlsBytes: number; activeJobs: number }>('/api/admin/cache') });
  const [form, setForm] = useState<AdminSettings | null>(null);
  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  const save = useMutation({
    mutationFn: (s: Partial<AdminSettings>) => api.patch<AdminSettings>('/api/admin/settings', s),
    onSuccess: (s) => {
      qc.setQueryData(['admin-settings'], s);
      void qc.invalidateQueries({ queryKey: ['admin-server'] });
    },
  });
  const clearCache = useMutation({ mutationFn: () => api.post('/api/admin/cache/clear'), onSuccess: () => void refetchCache() });
  const rebuild = useMutation({ mutationFn: () => api.post('/api/admin/search/rebuild') });

  if (isLoading || !form) return <Spinner className="mx-auto mt-16 h-8 w-8" />;
  const set = <K extends keyof AdminSettings>(k: K, v: AdminSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const num = (k: keyof AdminSettings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
    >
      <AdminHeader
        title="Settings"
        description="Changes apply immediately and are stored in the local database."
        action={
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save settings'}
          </Button>
        }
      />
      <ErrorText error={save.error} />
      {save.isSuccess && <p className="text-sm text-ok">Settings saved.</p>}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Server">
          <div className="space-y-4">
            <Field label="Server name">{(id) => <Input id={id} value={form.serverName} onChange={(e) => set('serverName', e.target.value)} />}</Field>
            <Toggle checked={form.mdnsEnabled} onChange={(v) => set('mdnsEnabled', v)} label="LAN discovery (mDNS)" description="Lets devices open http://NAME.local:PORT. The IP address always works too." />
            <Field label="mDNS host name" hint={`Devices can use http://${form.mdnsHostname}.local:${server?.port ?? 3000}`}>
              {(id) => <Input id={id} value={form.mdnsHostname} onChange={(e) => set('mdnsHostname', e.target.value.toLowerCase())} />}
            </Field>
            <Field label="Automatic rescan (minutes, 0 = off)">{(id) => <Input id={id} type="number" min={0} value={form.autoScanIntervalMinutes} onChange={num('autoScanIntervalMinutes')} />}</Field>
            <Toggle checked={form.thumbnailsEnabled} onChange={(v) => set('thumbnailsEnabled', v)} label="Generate thumbnails & backdrops" description="Extracts frames with FFmpeg during scans when no artwork files exist." />
          </div>
        </Card>

        <Card title="FFmpeg">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone={server?.ffmpeg.available ? 'ok' : 'bad'}>ffmpeg: {server?.ffmpeg.available ? `${server.ffmpeg.source} ${server.ffmpeg.version}` : 'not found'}</Badge>
              <Badge tone={server?.ffprobe.available ? 'ok' : 'bad'}>ffprobe: {server?.ffprobe.available ? `${server.ffprobe.source} ${server.ffprobe.version}` : 'not found'}</Badge>
            </div>
            <Field label="FFmpeg path" hint="Leave empty to auto-detect (PATH, then the bundled copy). Example: C:\ffmpeg\bin\ffmpeg.exe">
              {(id) => <Input id={id} className="font-mono" value={form.ffmpegPath} onChange={(e) => set('ffmpegPath', e.target.value)} />}
            </Field>
            <Field label="FFprobe path">{(id) => <Input id={id} className="font-mono" value={form.ffprobePath} onChange={(e) => set('ffprobePath', e.target.value)} />}</Field>
          </div>
        </Card>

        <Card title="Streaming & transcoding">
          <div className="space-y-4">
            <Field label="Default quality" hint="“Original” direct-plays when the device supports the file — the fastest, lowest-CPU option.">
              {(id) => (
                <Select id={id} value={form.defaultQuality} onChange={(e) => set('defaultQuality', e.target.value as AdminSettings['defaultQuality'])}>
                  <option value="original">Original (recommended)</option>
                  <option value="1080p">1080p</option>
                  <option value="720p">720p</option>
                  <option value="480p">480p</option>
                </Select>
              )}
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Max simultaneous streams">{(id) => <Input id={id} type="number" min={1} max={100} value={form.maxStreams} onChange={num('maxStreams')} />}</Field>
              <Field label="Max simultaneous transcodes" hint="0 disables transcoding">{(id) => <Input id={id} type="number" min={0} max={16} value={form.maxTranscodes} onChange={num('maxTranscodes')} />}</Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Encoder speed">
                {(id) => (
                  <Select id={id} value={form.transcodePreset} onChange={(e) => set('transcodePreset', e.target.value as AdminSettings['transcodePreset'])}>
                    {['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'].map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Hardware acceleration" hint="Falls back to CPU automatically if unavailable.">
                {(id) => (
                  <Select id={id} value={form.hardwareAcceleration} onChange={(e) => set('hardwareAcceleration', e.target.value as AdminSettings['hardwareAcceleration'])}>
                    <option value="none">None (CPU / x264)</option>
                    <option value="nvenc">NVIDIA NVENC</option>
                    <option value="qsv">Intel Quick Sync</option>
                    <option value="amf">AMD AMF</option>
                  </Select>
                )}
              </Field>
            </div>
            <Field label="HLS segment length (seconds)">{(id) => <Input id={id} type="number" min={2} max={10} value={form.hlsSegmentSeconds} onChange={num('hlsSegmentSeconds')} />}</Field>
          </div>
        </Card>

        <Card title="Cache & search">
          <div className="space-y-4">
            <Field label="Transcode cache limit (GB)" hint="Least-recently watched conversions are removed first.">
              {(id) => <Input id={id} type="number" min={0.5} step={0.5} value={form.cacheMaxGb} onChange={num('cacheMaxGb')} />}
            </Field>
            <p className="text-sm text-muted">
              Cache in use: <span className="text-fg">{formatBytes(cache?.hlsBytes ?? 0)}</span> · {cache?.activeJobs ?? 0} active FFmpeg jobs
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => confirm('Delete all converted HLS segments? Active conversions will stop.') && clearCache.mutate()}>Clear transcode cache</Button>
              <Button onClick={() => rebuild.mutate()} disabled={rebuild.isPending}>
                {rebuild.isSuccess ? 'Search index rebuilt' : 'Rebuild search index'}
              </Button>
            </div>
          </div>
        </Card>

        <Card title="This device">
          <TvModeToggle />
        </Card>

        <PasswordCard />
      </div>
    </form>
  );
}

function TvModeToggle() {
  const tvMode = usePrefs((s) => s.tvMode);
  const set = usePrefs((s) => s.set);
  const effective = tvMode ?? looksLikeTv();
  return (
    <Toggle
      checked={effective}
      onChange={(v) => set({ tvMode: v })}
      label="TV mode (larger text & controls)"
      description="Detected automatically on Smart TV browsers. Stored only on this device."
    />
  );
}

function PasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api.post('/api/auth/password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
    },
  });
  return (
    <Card title="Admin password">
      <div className="space-y-4">
        <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />}</Field>
        <Field label="New password" hint="At least 10 characters. Other sessions will be signed out.">
          {(id) => <Input id={id} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <ErrorText error={change.error} />
        {change.isSuccess && <p className="text-sm text-ok">Password changed.</p>}
        <Button onClick={() => change.mutate()} disabled={!current || next.length < 10 || change.isPending}>
          Change password
        </Button>
      </div>
    </Card>
  );
}
