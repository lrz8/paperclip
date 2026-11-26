import { useMemo, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import type { HeartbeatRun, RoutineRunSummary } from "@paperclipai/shared";
import { Activity, CircleDotDashed } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { heartbeatsApi } from "@/api/heartbeats";
import { routinesApi } from "@/api/routines";
import { EmptyState } from "@/components/EmptyState";
import { QueryErrorState, useQueryView, type QueryViewState } from "@/components/QueryView";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { canArchiveRun, RunLifecycleMenu, useRunLifecycleAction } from "@/components/run-log/RunLifecycleMenu";
import { useTranslation } from "@/i18n";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/queryKeys";
import { Link, useSearchParams } from "@/lib/router";
import { relativeTime } from "@/lib/utils";

const ALL = "__all";
const RUN_LIMIT = 100;

function runSummary(run: HeartbeatRun) {
  const result = run.resultJson as { summary?: unknown; result?: unknown } | null;
  const value = result?.summary ?? result?.result ?? run.error;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function runDuration(run: HeartbeatRun) {
  const start = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : null;
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function readableSource(source: string) {
  return source.replaceAll("_", " ");
}

function routineRunTitle(run: RoutineRunSummary) {
  return run.linkedIssue?.title ?? run.trigger?.label ?? "Routine run";
}

function RoutineScopedRuns({
  runs,
  view,
}: {
  runs: RoutineRunSummary[];
  view: QueryViewState<RoutineRunSummary[]>;
}) {
  // A loaded list stays on screen through a failed refetch; an outage before
  // the first load reads as loading, and only a real failure shows copy.
  if (view.kind === "loading" || view.kind === "reconnecting") {
    return (
      <div className="border-y border-border py-14 text-center text-sm text-muted-foreground">
        Loading routine runs…
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <QueryErrorState
        error={view.error}
        action="load routine runs"
        onRetry={view.retry}
        retrying={view.isFetching}
      />
    );
  }

  if (runs.length === 0) {
    return <EmptyState icon={Activity} message="No routine runs yet." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Routine runs</h2>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Executions created by this routine, newest first.
        </p>
      </div>
      <ul className="divide-y divide-border border-y border-border" aria-label="Routine runs">
        {runs.map((run) => {
          const content = (
            <>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{routineRunTitle(run)}</span>
                  <StatusBadge status={run.status} />
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">
                  {run.trigger?.label ?? readableSource(run.source)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground sm:justify-end">
                <span className="capitalize">{readableSource(run.source)}</span>
                <time dateTime={new Date(run.triggeredAt).toISOString()}>
                  {relativeTime(run.triggeredAt)}
                </time>
              </div>
            </>
          );
          const rowClassName = "flex flex-col gap-2 px-1 py-3 text-inherit no-underline transition-colors hover:bg-muted/50 sm:flex-row sm:items-start sm:justify-between sm:px-3";
          return (
            <li key={run.id}>
              {run.linkedIssue ? (
                <Link to={`/issues/${run.linkedIssue.identifier ?? run.linkedIssue.id}`} className={rowClassName}>
                  {content}
                </Link>
              ) : (
                <div className={rowClassName}>{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">Showing the {RUN_LIMIT} most recent routine runs.</p>
    </div>
  );
}

export function AuditRuns({
  companyId,
  routineId,
  lockedAgentId,
  hideHeader = false,
}: {
  companyId: string;
  routineId?: string;
  /** Pin the list to one agent and hide the agent filter (the agent page's Runs). */
  lockedAgentId?: string;
  hideHeader?: boolean;
}) {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const agentId = lockedAgentId ?? searchParams.get("agentId") ?? ALL;
  const status = searchParams.get("runStatus") ?? ALL;
  const archive = searchParams.get("runArchive") === "archived" ? "archived" : "active";
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const batch = useRunLifecycleAction(companyId);
  const agents = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !routineId,
  });
  const runs = useInfiniteQuery({
    queryKey: [...queryKeys.audit.runs(companyId, agentId === ALL ? null : agentId), archive],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      heartbeatsApi.list(companyId, agentId === ALL ? undefined : agentId, RUN_LIMIT, {
        summary: true, archive, beforeRunId: pageParam,
      }),
    getNextPageParam: (page) => page.length === RUN_LIMIT ? page.at(-1)?.id : undefined,
    refetchInterval: (query) => archive === "active" && query.state.data?.pages.length === 1 ? 15_000 : false,
    enabled: !routineId,
  });
  const routineRuns = useQuery({
    queryKey: [...queryKeys.routines.runs(routineId ?? ""), "audit"],
    queryFn: () => routinesApi.listRuns(routineId!, RUN_LIMIT),
    enabled: Boolean(routineId),
    refetchInterval: 15_000,
  });
  const runsView = useQueryView(runs);
  const routineRunsView = useQueryView(routineRuns);
  const agentById = useMemo(
    () => new Map((agents.data ?? []).map((agent) => [agent.id, agent])),
    [agents.data],
  );
  const loadedRuns = useMemo(() => runs.data?.pages.flat() ?? [], [runs.data]);
  const statuses = useMemo(
    () => Array.from(new Set(loadedRuns.map((run) => run.status))).sort(),
    [loadedRuns],
  );
  const visibleRuns = useMemo(
    () => {
      const needle = search.trim().toLowerCase();
      return loadedRuns.filter((run) => (status === ALL || run.status === status) && (!needle ||
        [run.id, agentById.get(run.agentId)?.name, run.contextSnapshot?.taskKey, runSummary(run)]
          .some((value) => typeof value === "string" && value.toLowerCase().includes(needle))));
    },
    [loadedRuns, status, search, agentById],
  );
  const visibleIds = new Set(visibleRuns.filter((run) => canArchiveRun(run)).map((run) => run.id));
  const visibleSelected = selected.filter((id) => visibleIds.has(id));

  const updateFilter = (key: "agentId" | "runStatus" | "runArchive", value: string) => {
    setSelected([]);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value === ALL) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  };

  const clearFilters = () => {
    setSearch("");
    setSelected([]);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("agentId");
        next.delete("runStatus");
        next.delete("runArchive");
        return next;
      },
      { replace: true },
    );
  };

  if (routineId) {
    return (
      <RoutineScopedRuns
        runs={routineRuns.data ?? []}
        view={routineRunsView}
      />
    );
  }

  return (
    <div className="space-y-4">
      {hideHeader ? null : (
        <div>
          <h2 className="text-lg font-semibold text-foreground">{t("runLifecycle.runs")}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Recent agent executions across the organization. Open a run to inspect its transcript,
            output, and task context.
          </p>
        </div>
      )}

      <div data-canonical-toolbar="audit-runs" role="toolbar" aria-label="Audit filters" className="flex flex-wrap items-end gap-3 border-y border-border py-3">
        <label className="grid gap-1 text-(length:--text-micro) font-medium text-muted-foreground">
          {t("runLifecycle.archiveFilter")}
          <Select value={archive} onValueChange={(value) => updateFilter("runArchive", value === "active" ? ALL : value)}>
            <SelectTrigger className="w-40" aria-label={t("runLifecycle.archiveFilter")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">{t("runLifecycle.active")}</SelectItem>
              <SelectItem value="archived">{t("runLifecycle.archived")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <Input className="w-56 max-w-full" type="search" aria-label={t("runLifecycle.search")} placeholder={t("runLifecycle.search")} value={search} onChange={(event) => setSearch(event.target.value)} />
        {lockedAgentId ? null : <label className="grid gap-1 text-(length:--text-micro) font-medium text-muted-foreground">
          <span>Agent</span>
          <Select value={agentId} onValueChange={(value) => updateFilter("agentId", value)}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All agents</SelectItem>
              {(agents.data ?? []).map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>}
        <label className="grid gap-1 text-(length:--text-micro) font-medium text-muted-foreground">
          <span>Status</span>
          <Select value={status} onValueChange={(value) => updateFilter("runStatus", value)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {statuses.map((value) => (
                <SelectItem key={value} value={value}>
                  {readableSource(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {(!lockedAgentId && agentId !== ALL) || status !== ALL || archive === "archived" || search ? (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
        {visibleSelected.length > 0 && <Button size="sm" variant="outline" disabled={batch.isPending} onClick={() => {
          batch.mutate({ action: archive === "archived" ? "restore" : "archive", runIds: visibleSelected }, {
            onSuccess: () => setSelected([]),
          });
        }}>{t(archive === "archived" ? "runLifecycle.batchRestore" : "runLifecycle.batchArchive", { count: visibleSelected.length })}</Button>}
      </div>

      {runsView.kind === "loading" || runsView.kind === "reconnecting" ? (
        <div className="border-y border-border py-14 text-center text-sm text-muted-foreground">
          Loading runs…
        </div>
      ) : runsView.kind === "error" ? (
        <QueryErrorState
          error={runsView.error}
          action="load runs"
          onRetry={runsView.retry}
          retrying={runsView.isFetching}
        />
      ) : visibleRuns.length === 0 ? (
        <EmptyState
          icon={agentId !== ALL || status !== ALL ? CircleDotDashed : Activity}
          message={t("runLifecycle.noMatches")}
        />
      ) : (
        <ul className="divide-y divide-border border-y border-border" aria-label="Recent runs">
          {visibleRuns.map((run) => {
            const agent = agentById.get(run.agentId);
            const summary = runSummary(run);
            const duration = runDuration(run);
            return (
              <li key={run.id} className="flex items-center gap-2 px-2">
                {canArchiveRun(run) && <Checkbox
                  aria-label={t("runLifecycle.select", { id: run.id.slice(0, 8) })}
                  checked={selected.includes(run.id)} disabled={batch.isPending}
                  onCheckedChange={(checked) => setSelected((previous) => checked ? [...previous, run.id] : previous.filter((id) => id !== run.id))}
                />}
                <Link
                  to={`/agents/${run.agentId}/runs/${run.id}`}
                  className="flex min-w-0 flex-1 flex-col gap-2 px-1 py-3 text-inherit no-underline transition-colors hover:bg-muted/50 sm:flex-row sm:items-start sm:justify-between sm:px-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">
                        {agent?.name ?? "Unknown agent"}
                      </span>
                      <span className="font-mono text-(length:--text-micro) text-muted-foreground">
                        {run.id.slice(0, 8)}
                      </span>
                      <StatusBadge status={run.status} />
                    </div>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {summary ?? `${readableSource(run.invocationSource)} run`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground sm:justify-end">
                    <span className="capitalize">{readableSource(run.invocationSource)}</span>
                    {duration ? <span>{duration}</span> : null}
                    <time dateTime={new Date(run.createdAt).toISOString()}>
                      {relativeTime(run.createdAt)}
                    </time>
                  </div>
                </Link>
                <RunLifecycleMenu run={run} />
              </li>
            );
          })}
        </ul>
      )}

      {runs.hasNextPage && <Button variant="outline" size="sm" disabled={runs.isFetching} onClick={() => { void runs.fetchNextPage(); }}>
        {t("runLifecycle.loadOlder")}
      </Button>}
    </div>
  );
}
