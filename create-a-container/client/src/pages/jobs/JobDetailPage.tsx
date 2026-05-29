import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  PageHeader,
  Spinner,
} from '@mieweb/ui';
import { ArrowLeft, Terminal } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { keys, queries } from '@/lib/queries';
import type { JobStatusRow } from '@/lib/types';

interface SseLogEvent {
  id: number;
  output: string;
  timestamp: string;
}

function statusVariant(s: string): 'default' | 'success' | 'warning' | 'danger' | 'secondary' {
  switch (s) {
    case 'running':
      return 'warning';
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'secondary';
    default:
      return 'default';
  }
}

export function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: job, isLoading, error, refetch } = useQuery({
    queryKey: keys.job(id!),
    queryFn: () => queries.getJob(id!),
    enabled: !!id,
  });

  const [logs, setLogs] = useState<JobStatusRow[]>([]);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Initial backfill of statuses.
  useEffect(() => {
    if (!id) return;
    queries.getJobStatuses(id).then(setLogs).catch(() => undefined);
  }, [id]);

  // Live SSE stream — only while job is pending/running.
  useEffect(() => {
    if (!id || !job) return;
    if (!['pending', 'running'].includes(job.status)) return;

    const lastId = logs.length > 0 ? logs[logs.length - 1].id : 0;
    const source = new EventSource(`/api/v1/jobs/${id}/stream?lastId=${lastId}`);

    source.addEventListener('log', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as SseLogEvent;
        setLogs((prev) =>
          prev.some((r) => r.id === data.id)
            ? prev
            : [...prev, { id: data.id, jobId: Number(id), output: data.output, createdAt: data.timestamp }],
        );
      } catch {
        /* ignore malformed payload */
      }
    });
    source.addEventListener('status', (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { status: string };
        setLiveStatus(data.status);
        refetch();
      } catch {
        /* ignore */
      }
      source.close();
    });
    source.onerror = () => source.close();

    return () => source.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, job?.status]);

  // Auto-scroll on new log lines.
  useEffect(() => {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  if (isLoading) return <div className="flex justify-center p-12"><Spinner size="lg" /></div>;
  if (error || !job) {
    return (
      <Alert variant="danger">
        <AlertDescription>{(error as ApiError | null)?.message || 'Job not found'}</AlertDescription>
      </Alert>
    );
  }

  const effectiveStatus = liveStatus || job.status;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Job #${job.id}`}
        subtitle={job.command}
        icon={<Terminal className="size-6" />}
        actions={
          <Link to=".." relative="path">
            <Button variant="ghost" leftIcon={<ArrowLeft className="size-4" />}>Back</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-4">
        <Badge variant={statusVariant(effectiveStatus)} size="lg">{effectiveStatus}</Badge>
        <span className="text-sm text-(--color-muted,#6b7280)">
          Started {new Date(job.createdAt).toLocaleString()} · by {job.createdBy}
        </span>
      </div>

      <div
        ref={containerRef}
        className="max-h-[60vh] overflow-auto rounded-lg border border-(--color-border,#e5e7eb) bg-(--color-surface-2,#0b1020) p-4 font-mono text-xs text-(--color-on-surface-2,#e5e7eb)"
      >
        {logs.length === 0 ? (
          <span className="text-(--color-muted,#9ca3af)">No log output yet…</span>
        ) : (
          logs.map((row) => (
            <pre key={row.id} className="whitespace-pre-wrap">
              {row.output}
            </pre>
          ))
        )}
      </div>
    </div>
  );
}
