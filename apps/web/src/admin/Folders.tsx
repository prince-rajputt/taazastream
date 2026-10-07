import type { MediaFolderInfo } from '@taazastream/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, Folder, FolderOpen, HardDrive, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Spinner } from '../components/States';
import { api, qs } from '../lib/api';
import { timeAgo } from '../lib/format';
import { AdminHeader } from './AdminApp';
import { ScanPanel, useStats } from './Dashboard';
import { Badge, Button, Card, Drawer, ErrorText, Field, Input, Select } from './ui';

interface BrowseResult {
  path: string | null;
  parent: string | null;
  entries: { name: string; path: string }[];
}

/** Lets the admin pick a folder on the server PC (lists folder names only). */
function FolderPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (p: string) => void }) {
  const [path, setPath] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-browse', path],
    queryFn: () => api.get<BrowseResult>(`/api/admin/fs/browse${qs({ path })}`),
    enabled: open,
  });
  return (
    <Drawer open={open} onClose={onClose} title="Choose a folder on the server">
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-ink px-3 py-2 font-mono text-xs break-all text-muted">
          {data?.path ?? 'This PC'}
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={!data?.path} onClick={() => setPath(data?.parent ?? null)}>
            <ChevronUp className="h-4 w-4" /> Up
          </Button>
          <Button size="sm" variant="primary" disabled={!data?.path} onClick={() => data?.path && onPick(data.path)}>
            Use this folder
          </Button>
        </div>
        <ErrorText error={error} />
        {isLoading ? (
          <Spinner className="mx-auto mt-8 h-8 w-8" />
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {data?.entries.length === 0 && <li className="px-4 py-3 text-sm text-faint">No sub-folders</li>}
            {data?.entries.map((e) => (
              <li key={e.path}>
                <button type="button" onClick={() => setPath(e.path)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-white/5">
                  {data.path ? <Folder className="h-4 w-4 text-brand-400" /> : <HardDrive className="h-4 w-4 text-brand-400" />}
                  <span className="truncate">{e.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

export default function FoldersPage() {
  const qc = useQueryClient();
  const { data: stats } = useStats();
  const { data: folders, isLoading, error } = useQuery({ queryKey: ['admin-folders'], queryFn: () => api.get<MediaFolderInfo[]>('/api/admin/media-folders'), refetchInterval: 5000 });
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'mixed' | 'movies' | 'series'>('mixed');
  const [picker, setPicker] = useState(false);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['admin-folders'] });
  const add = useMutation({
    mutationFn: () => api.post<MediaFolderInfo>('/api/admin/media-folders', { path, label: label || undefined, kind }),
    onSuccess: async (folder) => {
      setPath('');
      setLabel('');
      refresh();
      await api.post('/api/admin/scan', { folderId: folder.id }).catch(() => undefined);
      void qc.invalidateQueries({ queryKey: ['admin-stats'] });
    },
  });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<MediaFolderInfo> }) => api.patch(`/api/admin/media-folders/${id}`, body), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api.delete(`/api/admin/media-folders/${id}`), onSuccess: refresh });
  const rescan = useMutation({ mutationFn: (id: string) => api.post('/api/admin/scan', { folderId: id }), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-stats'] }) });

  return (
    <div className="space-y-6">
      <AdminHeader title="Media folders" description="Folders on this server PC that hold your videos. Files are indexed in place — never copied or modified." />

      <Card title="Add a folder">
        <form
          className="grid gap-4 md:grid-cols-[1fr_12rem_10rem_auto] md:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Folder path" hint="Example: D:\TaazaStream\Movies or E:\Movies">
            {(id) => (
              <div className="flex gap-2">
                <Input id={id} required value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\TaazaStream\Movies" className="font-mono" />
                <Button onClick={() => setPicker(true)} aria-label="Browse folders">
                  <FolderOpen className="h-4 w-4" /> Browse
                </Button>
              </div>
            )}
          </Field>
          <Field label="Label (optional)">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Movies" />}</Field>
          <Field label="Contains">
            {(id) => (
              <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                <option value="mixed">Movies & series</option>
                <option value="movies">Movies only</option>
                <option value="series">Series only</option>
              </Select>
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={add.isPending || !path.trim()}>
            <Plus className="h-4 w-4" /> Add & scan
          </Button>
        </form>
        <div className="mt-3">
          <ErrorText error={add.error} />
        </div>
        <details className="mt-4 text-sm text-muted">
          <summary className="cursor-pointer text-fg">How should files be named?</summary>
          <ul className="mt-2 space-y-1 font-mono text-xs leading-relaxed">
            <li>Movies\Interstellar (2014)\Interstellar (2014).mkv</li>
            <li>Movies\Interstellar (2014)\Interstellar (2014).en.srt  ← subtitles</li>
            <li>Movies\Interstellar (2014)\poster.jpg, fanart.jpg      ← artwork (optional)</li>
            <li>Movies\Interstellar (2014)\movie.nfo                   ← metadata (optional)</li>
            <li>Series\Dark\Season 01\Dark S01E01 - Secrets.mp4</li>
          </ul>
        </details>
      </Card>

      {stats && <ScanPanel stats={stats} />}

      <Card title="Library folders">
        <ErrorText error={error ?? remove.error ?? patch.error} />
        {isLoading ? (
          <Spinner className="mx-auto h-8 w-8" />
        ) : !folders?.length ? (
          <p className="text-sm text-muted">No folders yet. Add one above to start building your library.</p>
        ) : (
          <ul className="divide-y divide-line">
            {folders.map((f) => (
              <li key={f.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{f.label}</span>
                    {f.exists ? <Badge tone="ok">online</Badge> : <Badge tone="bad">not found</Badge>}
                    {!f.enabled && <Badge>disabled</Badge>}
                    <Badge tone="brand">{f.kind}</Badge>
                  </div>
                  <p className="mt-1 truncate font-mono text-xs text-muted">{f.path}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {f.videoCount} videos · scanned {timeAgo(f.lastScannedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select aria-label="Folder contents" value={f.kind} onChange={(e) => patch.mutate({ id: f.id, body: { kind: e.target.value as MediaFolderInfo['kind'] } })} className="h-8 w-36 text-xs">
                    <option value="mixed">Movies & series</option>
                    <option value="movies">Movies only</option>
                    <option value="series">Series only</option>
                  </Select>
                  <Button size="sm" onClick={() => patch.mutate({ id: f.id, body: { enabled: !f.enabled } })}>
                    {f.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" onClick={() => rescan.mutate(f.id)} disabled={!f.exists}>
                    <RefreshCw className="h-3.5 w-3.5" /> Rescan
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Remove “${f.label}” from the library?\n\nThis only removes it from TaazaStream. No files are deleted from disk.`)) remove.mutate(f.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <FolderPicker
        open={picker}
        onClose={() => setPicker(false)}
        onPick={(p) => {
          setPath(p);
          setPicker(false);
        }}
      />
    </div>
  );
}
