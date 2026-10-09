import { formatBytes, type SharedFile, type SharedKind } from '@taazastream/shared';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Images,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router';
import { EmptyState, ErrorState, Spinner } from '../components/States';
import { useDocumentTitle } from '../lib/hooks';
import { useAdminSignedIn, useDeleteShared, useSharedFiles, useUploadShared } from '../lib/queries';
import { PageHeader } from './Browse';

const ACCEPT: Record<SharedKind, string> = {
  pdf: 'application/pdf,.pdf',
  image: 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Upload button + whole-page drop target, shown only to the signed-in admin. */
function useUploader(kind: SharedKind) {
  const upload = useUploadShared(kind);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const send = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length) upload.mutate(files);
  };

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      send(e.dataTransfer.files);
    },
  };

  const button = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT[kind]}
        className="hidden"
        onChange={(e) => {
          send(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={upload.isPending}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/85 disabled:opacity-60"
      >
        {upload.isPending ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        {upload.isPending ? 'Uploading…' : kind === 'pdf' ? 'Upload PDFs' : 'Upload photos'}
      </button>
    </>
  );

  return { upload, button, dropProps, dragging };
}

function SharedPage({
  kind,
  title,
  icon,
  children,
}: {
  kind: SharedKind;
  title: string;
  icon: React.ReactNode;
  children: (files: SharedFile[], isAdmin: boolean) => React.ReactNode;
}) {
  useDocumentTitle(title);
  const { data, isLoading, error, refetch } = useSharedFiles(kind);
  const isAdmin = useAdminSignedIn();
  const { upload, button, dropProps, dragging } = useUploader(kind);
  const noun = kind === 'pdf' ? 'PDFs' : 'photos';

  return (
    <div className="page-x relative min-h-[70vh] pt-24 md:pt-28" {...(isAdmin ? dropProps : {})}>
      <PageHeader title={title}>
        <div className="flex items-center gap-3">
          {data && data.length > 0 && (
            <span className="text-sm text-muted">
              {data.length} {data.length === 1 ? noun.replace(/s$/, '') : noun}
            </span>
          )}
          {isAdmin && button}
        </div>
      </PageHeader>

      {upload.error && (
        <p
          role="alert"
          className="mb-6 rounded-xl border border-bad/40 bg-bad/10 px-4 py-3 text-sm"
        >
          {upload.error.message}
        </p>
      )}

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : !data?.length ? (
        <EmptyState
          icon={icon}
          title={`No ${noun} shared yet`}
          action={isAdmin ? button : undefined}
        >
          {isAdmin ? (
            `Upload ${noun} here (or drag and drop them onto this page). Every device connected to TaazaStream can then open and download them.`
          ) : (
            <>
              {`${noun[0]!.toUpperCase()}${noun.slice(1)} shared from the server PC appear here. To share some, `}
              <Link to="/admin" className="text-fg underline underline-offset-4">
                sign in to the admin dashboard
              </Link>
              {' and come back to this page.'}
            </>
          )}
        </EmptyState>
      ) : (
        children(data, isAdmin)
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="rounded-3xl border-2 border-dashed border-brand-400 px-12 py-10 text-center">
            <Upload className="mx-auto mb-3 h-8 w-8 text-brand-400" />
            <p className="font-display text-xl font-semibold">Drop {noun} to share them</p>
          </div>
        </div>
      )}
    </div>
  );
}

function DeleteButton({
  file,
  kind,
  className = '',
  onDeleted,
}: {
  file: SharedFile;
  kind: SharedKind;
  className?: string;
  onDeleted?: () => void;
}) {
  const del = useDeleteShared(kind);
  return (
    <button
      type="button"
      aria-label={`Delete ${file.name}`}
      title="Delete"
      disabled={del.isPending}
      onClick={() => {
        if (window.confirm(`Delete "${file.name}" for every device?`))
          del.mutate(file.id, { onSuccess: onDeleted });
      }}
      className={`flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-bad/20 hover:text-bad disabled:opacity-50 ${className}`}
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}

/* ------------------------------ PDFs ------------------------------ */

export function PdfsPage() {
  return (
    <SharedPage kind="pdf" title="PDFs" icon={<FileText className="h-7 w-7" />}>
      {(files, isAdmin) => (
        // grid-cols-1 (minmax(0, 1fr)): an implicit auto column grows to fit a long file name
        // and pushes the card off narrow phone screens.
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface p-3 pr-1.5 transition hover:border-line-strong sm:gap-4 sm:pr-2"
            >
              <a
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-1 items-center gap-3 rounded-xl sm:gap-4"
              >
                <span className="flex h-14 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-red-500/25 to-red-500/10 text-[0.65rem] font-bold tracking-wide text-red-300 ring-1 ring-red-400/30">
                  PDF
                </span>
                <span className="min-w-0">
                  {/* Names like "Log_Management_Guide.pdf" have no spaces: allow breaks anywhere. */}
                  <span
                    className="line-clamp-2 text-sm leading-snug font-medium wrap-anywhere"
                    title={f.name}
                  >
                    {f.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {formatBytes(f.sizeBytes)} · {formatDate(f.uploadedAt)}
                  </span>
                </span>
              </a>
              <div className="flex shrink-0 items-center">
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${f.name}`}
                  title="Open"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
                <a
                  href={f.downloadUrl}
                  download={f.name}
                  aria-label={`Download ${f.name}`}
                  title="Download"
                  className="flex h-9 w-9 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  <Download className="h-4 w-4" />
                </a>
                {isAdmin && <DeleteButton file={f} kind="pdf" />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </SharedPage>
  );
}

/* ------------------------------ Gallery ------------------------------ */

function Lightbox({
  files,
  index,
  isAdmin,
  onIndex,
  onClose,
}: {
  files: SharedFile[];
  index: number;
  isAdmin: boolean;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const file = files[index];
  const touchX = useRef<number | null>(null);
  const go = useCallback(
    (d: number) => onIndex((index + d + files.length) % files.length),
    [index, files.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = overflow;
    };
  }, [go, onClose]);

  if (!file) return null;
  const many = files.length > 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={file.name}
      className="fixed inset-0 z-[80] flex flex-col bg-black/95 animate-fade-in"
      onTouchStart={(e) => (touchX.current = e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start != null && end != null && Math.abs(end - start) > 50) go(end < start ? 1 : -1);
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 md:px-5"
        style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
      >
        <p className="min-w-0 flex-1 truncate text-sm text-white/80">
          {file.name}
          {many && (
            <span className="ml-2 text-white/45">
              {index + 1} / {files.length}
            </span>
          )}
        </p>
        <a
          href={file.downloadUrl}
          download={file.name}
          aria-label="Download"
          title="Download"
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Download className="h-5 w-5" />
        </a>
        {isAdmin && (
          <DeleteButton
            file={file}
            kind="image"
            className="h-10 w-10"
            onDeleted={() =>
              files.length <= 1 ? onClose() : go(index === files.length - 1 ? -1 : 0)
            }
          />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          autoFocus
          className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <div
        className="relative min-h-0 flex-1"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <img
          key={file.id}
          src={file.url}
          alt={file.name}
          className="absolute inset-0 m-auto max-h-full max-w-full object-contain p-2 md:p-6"
        />
        {many && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute top-1/2 left-2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 md:left-5"
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute top-1/2 right-2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 md:right-5"
            >
              <ChevronRight className="h-7 w-7" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function GalleryGrid({ files, isAdmin }: { files: SharedFile[]; isAdmin: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  // Keep the viewer in range when a photo is deleted (here or on another device).
  const index = open == null ? null : Math.min(open, files.length - 1);

  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 md:gap-3 lg:grid-cols-5 2xl:grid-cols-6">
        {files.map((f, i) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => setOpen(i)}
              aria-label={`View ${f.name}`}
              className="group relative block aspect-square w-full overflow-hidden rounded-[var(--radius-card)] bg-surface ring-1 ring-line"
            >
              <img
                src={f.thumbUrl ?? f.url}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
              />
            </button>
          </li>
        ))}
      </ul>
      {index != null && index >= 0 && (
        <Lightbox
          files={files}
          index={index}
          isAdmin={isAdmin}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

export function GalleryPage() {
  return (
    <SharedPage kind="image" title="Gallery" icon={<Images className="h-7 w-7" />}>
      {(files, isAdmin) => <GalleryGrid files={files} isAdmin={isAdmin} />}
    </SharedPage>
  );
}
