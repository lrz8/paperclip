import { useTranslation } from "@/i18n";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Pause,
  Play,
  Plus,
  MoreHorizontal,
  MessagesSquare,
  Loader2,
  Copy,
  RotateCcw,
  Trash2,
  CheckCircle2,
  Bug,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AgentStatusBadge } from "./StatusBadge";
import { agentsApi } from "../api/agents";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";
import { agentRouteRef, cn } from "../lib/utils";
import { pendingAgentSetupChoice } from "../lib/agent-setup-choice";
import { copyTextToClipboard } from "../lib/clipboard";
import { useDialogActions } from "../context/DialogContext";
import { useToastActions } from "../context/ToastContext";
import {
  buildDuplicateAgentPayload,
  duplicateAgentName,
  type DuplicateInstructionsBundle,
} from "../lib/duplicate-agent-payload";
import type {
  Agent,
  AgentInstructionsBundle,
  AgentInstructionsFileSummary,
  HeartbeatRun,
} from "@paperclipai/shared";

export function RunButton({
  onClick,
  disabled,
  label,
  size = "sm",
}: {
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "default";
}) {
  const { t } = useTranslation();
  return (
    <Button variant="outline" size={size} onClick={onClick} disabled={disabled}>
      <Play className="h-3.5 w-3.5 sm:mr-1" />
      <span className="hidden sm:inline">{label ?? t("agentDetail.runNow")}</span>
    </Button>
  );
}

export function PauseResumeButton({
  isPaused,
  onPause,
  onResume,
  disabled,
  size = "sm",
}: {
  isPaused: boolean;
  onPause: () => void;
  onResume: () => void;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  const { t } = useTranslation();
  if (isPaused) {
    return (
      <Button variant="outline" size={size} onClick={onResume} disabled={disabled}>
        <Play className="h-3.5 w-3.5 sm:mr-1" />
        <span className="hidden sm:inline">{t("agentDetail.resumeAgent")}</span>
      </Button>
    );
  }

  return (
    <Button variant="outline" size={size} onClick={onPause} disabled={disabled}>
      <Pause className="h-3.5 w-3.5 sm:mr-1" />
      <span className="hidden sm:inline">{t("agentDetail.pauseAgent")}</span>
    </Button>
  );
}

export function ClearErrorButton({
  onClick,
  disabled,
  size = "sm",
}: {
  onClick: () => void;
  disabled?: boolean;
  size?: "sm" | "default";
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      size={size}
      onClick={onClick}
      disabled={disabled}
      className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/50"
      aria-label={t("agentDetail.clearAgentError")}
    >
      <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1" />
      <span className="hidden sm:inline">{t("agentDetail.clearError")}</span>
    </Button>
  );
}

function duplicateInstructionFilePath(
  _bundle: AgentInstructionsBundle,
  summary: AgentInstructionsFileSummary,
): string | null {
  if (summary.deprecated || summary.virtual) return null;
  return summary.path;
}

export async function loadDuplicateInstructionsBundle(
  agentId: string,
  companyId?: string,
): Promise<DuplicateInstructionsBundle | null> {
  const bundle = await agentsApi.instructionsBundle(agentId, companyId);
  const files: Record<string, string> = {};

  for (const summary of bundle.files) {
    const path = duplicateInstructionFilePath(bundle, summary);
    if (!path) continue;
    const file = await agentsApi.instructionsFile(agentId, summary.path, companyId);
    files[path] = file.content;
  }

  const entryFile = Object.prototype.hasOwnProperty.call(files, bundle.entryFile)
    ? bundle.entryFile
    : Object.keys(files)[0] ?? "AGENTS.md";
  return Object.keys(files).length > 0 ? { entryFile, files } : null;
}

/**
 * Shared agent action cluster used by both the agent detail header and the
 * agents list rows. Encapsulates the invoke / pause / resume / terminate /
 * duplicate / reset-session mutations so callers do not diverge in behavior.
 */
export function AgentActionButtons({
  agent,
  companyId,
  size = "sm",
  assignLabel: customAssignLabel,
  showAssignIcon = true,
  assignIcon: AssignIcon = Plus,
  showChat = false,
  runLabel: customRunLabel,
  showStatus = true,
  showRun = true,
  actionsDisabled = false,
  workActionsDisabled = false,
  workActionsDisabledReason,
  navigateToRunOnInvoke = true,
  hasPendingNavigationChanges = false,
  onBeforeNavigate,
  onActionError,
  onTerminateSuccess,
  onDeleteSuccess,
  pauseConfirm,
  hideTerminate = false,
  workActionsInMenu = false,
  lifecycleOnly = false,
  menuItems = [],
  children,
  className,
}: {
  agent: Agent;
  companyId?: string | null;
  size?: "sm" | "default";
  assignLabel?: string;
  showAssignIcon?: boolean;
  assignIcon?: typeof Plus;
  showChat?: boolean;
  runLabel?: string;
  showStatus?: boolean;
  showRun?: boolean;
  actionsDisabled?: boolean;
  workActionsDisabled?: boolean;
  workActionsDisabledReason?: string;
  navigateToRunOnInvoke?: boolean;
  /** Whether the caller currently has an unsaved draft that navigation would discard. */
  hasPendingNavigationChanges?: boolean;
  /** Return false to stop an action whose success would navigate away. */
  onBeforeNavigate?: () => boolean;
  /**
   * When set, pausing prompts a confirmation dialog first (e.g. for built-in
   * agents that power a feature). Omit for the immediate-pause default.
   */
  pauseConfirm?: { title: string; description: ReactNode };
  /** Hide the Terminate action (e.g. built-in agents are undeletable). */
  hideTerminate?: boolean;
  /** Put Run now, Pause/Resume and Clear error in the overflow menu, leaving Assign task (or Finish setup, while setup is pending) as the one button. */
  workActionsInMenu?: boolean;
  lifecycleOnly?: boolean;
  /** Extra overflow items shown after the work actions when `workActionsInMenu` is on. */
  menuItems?: ReadonlyArray<{ label: string; icon: typeof Plus; onSelect: () => void; disabled?: boolean }>;
  /**
   * Optional inline error reporter. When provided it is used instead of a toast
   * for action failures (preserves the detail page's inline error banner). When
   * omitted, failures surface as toasts (used by the list view).
   */
  onActionError?: (message: string | null) => void;
  onTerminateSuccess?: (agent: Agent) => void;
  onDeleteSuccess?: () => void;
  /** Extra content rendered just before the overflow menu (e.g. live-run link). */
  children?: React.ReactNode;
  className?: string;
}) {
  const { t } = useTranslation();
  const assignLabel = customAssignLabel ?? t("agentDetail.assignTask");
  const runLabel = customRunLabel ?? t("agentDetail.runNow");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openNewIssue } = useDialogActions();
  const { pushToast } = useToastActions();
  const [moreOpen, setMoreOpen] = useState(false);
  const [pauseConfirmOpen, setPauseConfirmOpen] = useState(false);
  const [confirmLifecycle, setConfirmLifecycle] = useState<"archive" | "terminate" | "delete" | null>(null);
  const pendingNavigationChangesRef = useRef(hasPendingNavigationChanges);
  const beforeNavigateRef = useRef(onBeforeNavigate);
  const agentActionStartedDirtyRef = useRef(false);
  const duplicateStartedDirtyRef = useRef(false);
  pendingNavigationChangesRef.current = hasPendingNavigationChanges;
  beforeNavigateRef.current = onBeforeNavigate;

  function confirmNavigationStart(startedDirtyRef: React.MutableRefObject<boolean>) {
    startedDirtyRef.current = pendingNavigationChangesRef.current;
    return beforeNavigateRef.current?.() !== false;
  }

  function confirmLateNavigationChanges(startedDirtyRef: React.MutableRefObject<boolean>) {
    return (
      !pendingNavigationChangesRef.current ||
      startedDirtyRef.current ||
      beforeNavigateRef.current?.() !== false
    );
  }

  const resolvedCompanyId = companyId ?? agent.companyId;
  const canonicalAgentRef = agentRouteRef(agent);
  const isPaused = agent.lifecycleState ? agent.lifecycleState === "paused" : agent.status === "paused";
  const isArchived = agent.archived === true;
  const isTerminated = agent.status === "terminated";
  const isAgentError = agent.status === "error";
  const needsSetup = agent.pauseReason === "setup" && agent.status !== "terminated"
    && !["terminating", "cleaning_up", "terminated", "rejected"].includes(agent.lifecycleState ?? "");

  const reportError = useCallback(
    (message: string) => {
      if (onActionError) {
        onActionError(message);
      } else {
        pushToast({ title: t("agentDetail.actionError"), body: message, tone: "error" });
      }
    },
    [onActionError, pushToast],
  );

  const invalidateAgent = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agent.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(canonicalAgentRef) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.runtimeState(agent.id) });
    queryClient.invalidateQueries({ queryKey: queryKeys.agents.taskSessions(agent.id) });
    if (resolvedCompanyId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(resolvedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.org(resolvedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.liveRuns(resolvedCompanyId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.heartbeats(resolvedCompanyId, agent.id) });
    }
  }, [agent.id, canonicalAgentRef, queryClient, resolvedCompanyId]);

  const agentAction = useMutation({
    mutationFn: async (action: "invoke" | "pause" | "resume" | "clear_error" | "approve" | "archive" | "unarchive" | "terminate") => {
      switch (action) {
        case "invoke": return agentsApi.invoke(agent.id, resolvedCompanyId ?? undefined);
        case "pause": return agentsApi.pause(agent.id, resolvedCompanyId ?? undefined);
        case "resume": return agentsApi.resume(agent.id, resolvedCompanyId ?? undefined);
        case "clear_error": return agentsApi.clearError(agent.id, resolvedCompanyId ?? undefined);
        case "approve": return agentsApi.approve(agent.id, resolvedCompanyId ?? undefined);
        case "archive": return agentsApi.archive(agent.id, resolvedCompanyId ?? undefined);
        case "unarchive": return agentsApi.unarchive(agent.id, resolvedCompanyId ?? undefined);
        case "terminate": return agentsApi.terminate(agent.id, resolvedCompanyId ?? undefined);
      }
    },
    onSuccess: (data, action) => {
      onActionError?.(null);
      invalidateAgent();
      if (action === "terminate") {
        if (!confirmLateNavigationChanges(agentActionStartedDirtyRef)) return;
        onTerminateSuccess?.(data as Agent);
      }
      if (action === "invoke" && navigateToRunOnInvoke && data && typeof data === "object" && "id" in data) {
        if (!confirmLateNavigationChanges(agentActionStartedDirtyRef)) return;
        navigate(`/agents/${canonicalAgentRef}/runs/${(data as HeartbeatRun).id}`);
      }
    },
    onError: (err) => {
      reportError(err instanceof Error ? err.message : t("agentDetail.actionError"));
    },
  });

  const deletionImpact = useQuery({
    queryKey: [...queryKeys.agents.detail(agent.id), "delete-impact", resolvedCompanyId],
    queryFn: () => agentsApi.deleteImpact(agent.id, resolvedCompanyId ?? undefined),
    enabled: confirmLifecycle === "delete",
    refetchOnMount: "always",
  });
  const remove = useMutation({
    mutationFn: () => agentsApi.remove(agent.id, resolvedCompanyId ?? undefined),
    onSuccess: () => {
      setConfirmLifecycle(null);
      onActionError?.(null);
      invalidateAgent();
      onDeleteSuccess?.();
    },
    onError: (error) => reportError(error instanceof Error ? error.message : t("agentDetail.actionError")),
  });

  const duplicateAgent = useMutation({
    mutationFn: async () => {
      if (!resolvedCompanyId) {
        throw new Error("Agent is not ready to duplicate");
      }
      const instructionsBundle = await loadDuplicateInstructionsBundle(agent.id, resolvedCompanyId);
      const payload = buildDuplicateAgentPayload(agent, instructionsBundle);
      try {
        return await agentsApi.create(resolvedCompanyId, payload);
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.message.includes("requires board approval")) {
          const hire = await agentsApi.hire(resolvedCompanyId, payload);
          return hire.agent;
        }
        throw error;
      }
    },
    onSuccess: async (createdAgent) => {
      onActionError?.(null);
      if (resolvedCompanyId) {
        await queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(resolvedCompanyId) });
      }
      pushToast({ title: t("agentDetail.agentDuplicated"), body: createdAgent.name, tone: "success" });
      if (!confirmLateNavigationChanges(duplicateStartedDirtyRef)) return;
      navigate(`/agents/${agentRouteRef(createdAgent)}/dashboard`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : t("agentDetail.duplicateAgentFailed");
      onActionError?.(message);
      pushToast({ title: t("agentDetail.duplicateAgentError"), body: message, tone: "error" });
    },
  });

  const handleDuplicateAgent = useCallback(() => {
    if (duplicateAgent.isPending) return;
    const nextName = duplicateAgentName(agent.name);
    const confirmed = window.confirm(t("agentDetail.confirmDuplicateAgent", { name: agent.name, nextName }));
    setMoreOpen(false);
    if (!confirmed || !confirmNavigationStart(duplicateStartedDirtyRef)) return;
    duplicateAgent.mutate();
  }, [agent.name, duplicateAgent, t]);

  const resetTaskSession = useMutation({
    mutationFn: () => agentsApi.resetSession(agent.id, null, resolvedCompanyId ?? undefined),
    onSuccess: () => {
      onActionError?.(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.runtimeState(agent.id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.agents.taskSessions(agent.id) });
    },
    onError: (err) => {
      reportError(err instanceof Error ? err.message : t("agentDetail.resetSessionError"));
    },
  });

  const isPendingApproval = agent.status === "pending_approval";
  const disabled = actionsDisabled || agentAction.isPending;
  const assignAndRunDisabled = disabled || isPendingApproval || workActionsDisabled || isTerminated || isArchived;
  const pauseResumeDisabled = disabled || isPendingApproval || isArchived || (isPaused && workActionsDisabled)
    || Boolean(agent.lifecycleState && ["pausing", "terminating", "cleaning_up", "terminated", "rejected"].includes(agent.lifecycleState));
  const clearErrorDisabled = disabled;
  const runtimeConfig = agent.runtimeConfig as Record<string, unknown> | null;
  const runtimeDebug =
    runtimeConfig && typeof runtimeConfig.debug === "object" && runtimeConfig.debug !== null
      ? (runtimeConfig.debug as Record<string, unknown>)
      : null;
  const persistentProviderTrace = runtimeDebug?.providerTrace === "raw";

  const finishSetup = () => {
    if (!confirmNavigationStart(agentActionStartedDirtyRef)) return;
    navigate(`/agents/new?${new URLSearchParams({
      name: agent.name, adapterType: agent.adapterType, setupAgentId: agent.id,
      runnerProvider: String(agent.adapterConfig.provider === "acpx" ? agent.adapterConfig.acpxAgent : agent.adapterConfig.provider ?? "codex"),
      ...(agent.adapterType === "paperclip_runner" ? { runner: "paperclip" } : ["codex_local", "claude_local", "opencode_local", "pi_local"].includes(agent.adapterType) ? { runner: "legacy" } : {}),
      ...pendingAgentSetupChoice(agent),
    })}`);
  };
  const pauseDialog = pauseConfirm ? (
    <AlertDialog open={pauseConfirmOpen} onOpenChange={setPauseConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pauseConfirm.title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>{pauseConfirm.description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={() => agentAction.mutate("pause")}>
            {t("agentDetail.pauseAnyway")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  const showArchive = !hideTerminate && !isTerminated && !isPendingApproval && !needsSetup;
  const stopMenuItem = (item: string, icon: string) => {
    const Icon = isArchived ? ArchiveRestore : Archive;
    return <>
      {showArchive && <button type="button" className={item} disabled={disabled} onClick={() => {
        setMoreOpen(false);
        if (isArchived) agentAction.mutate("unarchive");
        else setConfirmLifecycle("archive");
      }}><Icon className={icon} />{t(isArchived ? "agentDetail.unarchiveAgent" : "agentDetail.archiveAgent")}</button>}
      {!hideTerminate && <button type="button" className={cn(item, "text-destructive")} disabled={disabled} onClick={() => {
        setMoreOpen(false);
        setConfirmLifecycle(isTerminated ? "delete" : "terminate");
      }}><Trash2 className={cn(icon, "text-destructive")} />
        {t(isTerminated ? "agentDetail.deleteAgent" : "agentDetail.terminateAgent")}
      </button>}
    </>;
  };
  const impact = deletionImpact.data;
  const lifecycleDialog = <AlertDialog open={confirmLifecycle !== null} onOpenChange={open => {
    if (!open && !remove.isPending) setConfirmLifecycle(null);
  }}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{t(confirmLifecycle === "delete" ? "agentDetail.deleteAgent"
          : confirmLifecycle === "terminate" ? "agentDetail.terminateAgent" : "agentDetail.archiveAgent")}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="space-y-2">
            <p>{t(confirmLifecycle === "delete" ? "agentDetail.deleteAgentConfirm"
              : confirmLifecycle === "terminate" ? "agentDetail.terminateAgentConfirm" : "agentDetail.archiveAgentConfirm", { name: agent.name })}</p>
            {confirmLifecycle === "delete" && <>
              {deletionImpact.isPending && <p role="status">{t("agentDetail.deleteImpactLoading")}</p>}
              {deletionImpact.error && <p role="alert">{deletionImpact.error.message}</p>}
              {impact && <p>{t("agentDetail.deleteAgentCounts", { ...impact.counts })}</p>}
              {impact?.blockedReason && <p role="alert">{String(t(`agentDetail.deleteBlockers.${impact.blockedCode}`, { defaultValue: impact.blockedReason }))}</p>}
              {remove.error && <p role="alert">{remove.error.message}</p>}
            </>}
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={remove.isPending}>{t("common.cancel")}</AlertDialogCancel>
        {confirmLifecycle === "delete" ? (
          <Button variant="destructive" disabled={remove.isPending || deletionImpact.isFetching || !impact?.allowed}
            onClick={() => { if (!onDeleteSuccess || confirmNavigationStart(agentActionStartedDirtyRef)) remove.mutate(); }}>
            {t("agentDetail.deleteAgent")}
          </Button>
        ) : (
          <AlertDialogAction onClick={event => {
            if (confirmLifecycle === "archive") agentAction.mutate("archive");
            else if (!onTerminateSuccess || confirmNavigationStart(agentActionStartedDirtyRef)) agentAction.mutate("terminate");
            else event.preventDefault();
          }}>{t(confirmLifecycle === "terminate" ? "agentDetail.terminateAgent" : "agentDetail.archiveAgent")}</AlertDialogAction>
        )}
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;

  if (workActionsInMenu || lifecycleOnly) {
    const item = "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50";
    const icon = "size-4 shrink-0 text-muted-foreground";
    const select = (action: () => void) => () => {
      setMoreOpen(false);
      action();
    };
    return (
      <div className={className ?? "flex shrink-0 items-center gap-2"}>
        {persistentProviderTrace ? (
          <span
            className="hidden items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary lg:inline-flex"
            title={t("agentDetail.rawTracingDescription")}
          >
            <Bug className="h-3.5 w-3.5" />
            {t("agentDetail.rawTracingOn")}
          </span>
        ) : null}
        {children}
        <Popover open={moreOpen} onOpenChange={setMoreOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={t("agentDetail.openAgentActions", { name: agent.name })}>
              <MoreHorizontal className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1" align="end">
            {lifecycleOnly ? null : needsSetup ? (
              <button
                type="button"
                className={item}
                disabled={assignAndRunDisabled}
                title={workActionsDisabled ? workActionsDisabledReason : undefined}
                onClick={select(() => openNewIssue({ assigneeAgentId: agent.id }))}
              >
                <Plus className={icon} />
                {assignLabel}
              </button>
            ) : showRun ? (
              <button
                type="button"
                className={item}
                disabled={assignAndRunDisabled}
                title={workActionsDisabled ? workActionsDisabledReason : undefined}
                onClick={select(() => {
                  if (navigateToRunOnInvoke && !confirmNavigationStart(agentActionStartedDirtyRef)) return;
                  agentAction.mutate("invoke");
                })}
              >
                <Play className={icon} />
                {runLabel}
              </button>
            ) : null}
            {needsSetup || isArchived || isTerminated ? null : isAgentError ? (
              <button
                type="button"
                className={cn(item, "text-destructive")}
                disabled={clearErrorDisabled}
                aria-label={t("agentDetail.clearAgentError")}
                onClick={select(() => agentAction.mutate("clear_error"))}
              >
                <CheckCircle2 className={cn(icon, "text-destructive")} />
                {t("agentDetail.clearError")}
              </button>
            ) : isPaused ? (
              <button type="button" className={item} disabled={pauseResumeDisabled} onClick={select(() => agentAction.mutate("resume"))}>
                <Play className={icon} />
                {t("agentDetail.resumeAgent")}
              </button>
            ) : (
              <button
                type="button"
                className={item}
                disabled={pauseResumeDisabled}
                onClick={select(() => (pauseConfirm ? setPauseConfirmOpen(true) : agentAction.mutate("pause")))}
              >
                <Pause className={icon} />
                {t("agentDetail.pauseAgent")}
              </button>
            )}
            {!lifecycleOnly && <>
            <div role="separator" className="-mx-1 my-1 h-px bg-border" />
            {menuItems.map(({ label, icon: Icon, onSelect, disabled: itemDisabled }) => (
              <button key={label} type="button" className={item} disabled={itemDisabled} onClick={select(onSelect)}>
                <Icon className={icon} />
                {label}
              </button>
            ))}
            <button type="button" className={item} disabled={duplicateAgent.isPending} onClick={handleDuplicateAgent}>
              {duplicateAgent.isPending ? <Loader2 className={cn(icon, "animate-spin")} /> : <Copy className={icon} />}
              {t("agentDetail.duplicateAgent")}
            </button>
            <button
              type="button"
              className={item}
              onClick={select(() => {
                void copyTextToClipboard(agent.id).catch(() => {
                  pushToast({ title: t("agentDetail.copyFailed"), body: t("agentDetail.clipboardUnavailable"), tone: "error" });
                });
              })}
            >
              <Copy className={icon} />
              {t("agentDetail.copyAgentIdSentence")}
            </button>
            <button type="button" className={item} onClick={select(() => resetTaskSession.mutate())}>
              <RotateCcw className={icon} />
              {t("agentDetail.resetSessions")}
            </button>
            </>}
            {stopMenuItem(item, icon)}
          </PopoverContent>
        </Popover>
        {!lifecycleOnly && isArchived && <Badge variant="secondary">{t("agentDetail.archived")}</Badge>}
        {!lifecycleOnly && showChat && <Button variant="outline" size={size} aria-label={t("agentDetail.chatWithNamedAgent", { name: agent.name })} title={t("agentDetail.chatWithAgentTitle")}
          disabled={disabled} onClick={() => { if (!onBeforeNavigate || onBeforeNavigate()) navigate(`/chats/${canonicalAgentRef}`); }}>
          <MessagesSquare className="size-4" />
          {t("nav.chat")}
        </Button>}
        {lifecycleOnly ? null : needsSetup ? (
          <Button size={size} disabled={disabled} onClick={finishSetup}>
            <Play className="size-4" />
            {t("agentDetail.finishSetup")}
          </Button>
        ) : (
          <Button
            size={size}
            onClick={() => openNewIssue({ assigneeAgentId: agent.id })}
            disabled={assignAndRunDisabled}
            title={workActionsDisabled ? workActionsDisabledReason : undefined}
          >
            {showAssignIcon && <AssignIcon className="size-4" />}
            {assignLabel}
          </Button>
        )}
        {pauseDialog}
        {lifecycleDialog}
      </div>
    );
  }

  return (
    <div className={className ?? "flex items-center gap-1 sm:gap-2 shrink-0"}>
      {persistentProviderTrace ? (
        <span
          className="hidden items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary lg:inline-flex"
          title={t("agentDetail.rawTracingDescription")}
        >
          <Bug className="h-3.5 w-3.5" />
          {t("agentDetail.rawTracingOn")}
        </span>
      ) : null}
      <Button
        variant="outline"
        size={size}
        onClick={() => openNewIssue({ assigneeAgentId: agent.id })}
        disabled={assignAndRunDisabled}
        title={workActionsDisabled ? workActionsDisabledReason : undefined}
      >
        <Plus className="h-3.5 w-3.5 sm:mr-1" />
        <span className="hidden sm:inline">{assignLabel}</span>
      </Button>
      {needsSetup ? (
        <Button variant="outline" size={size} disabled={disabled} onClick={() => {
          if (!confirmNavigationStart(agentActionStartedDirtyRef)) return;
          navigate(`/agents/new?${new URLSearchParams({
            name: agent.name, adapterType: agent.adapterType, setupAgentId: agent.id,
            runnerProvider: String(agent.adapterConfig.provider === "acpx" ? agent.adapterConfig.acpxAgent : agent.adapterConfig.provider ?? "codex"),
            ...(agent.adapterType === "paperclip_runner" ? { runner: "paperclip" } : ["codex_local", "claude_local", "opencode_local", "pi_local"].includes(agent.adapterType) ? { runner: "legacy" } : {}),
            ...pendingAgentSetupChoice(agent),
          })}`);
        }}>{t("agentDetail.finishSetup")}</Button>
      ) : showRun && <RunButton
        onClick={() => {
          if (navigateToRunOnInvoke && !confirmNavigationStart(agentActionStartedDirtyRef)) return;
          agentAction.mutate("invoke");
        }}
        disabled={assignAndRunDisabled}
        label={runLabel}
        size={size}
      />}
      {!needsSetup && !isArchived && !isTerminated && (agent.status === "error" ? (
        <ClearErrorButton
          onClick={() => agentAction.mutate("clear_error")}
          disabled={clearErrorDisabled}
          size={size}
        />
      ) : (
        <PauseResumeButton
          isPaused={isPaused}
          onPause={() => (pauseConfirm ? setPauseConfirmOpen(true) : agentAction.mutate("pause"))}
          onResume={() => agentAction.mutate("resume")}
          disabled={pauseResumeDisabled}
          size={size}
        />
      ))}
      {pauseConfirm && (
        <AlertDialog open={pauseConfirmOpen} onOpenChange={setPauseConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{pauseConfirm.title}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div>{pauseConfirm.description}</div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={() => agentAction.mutate("pause")}>
                {t("agentDetail.pauseAnyway")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {showStatus && (
        <span className="hidden sm:inline">
          {isArchived ? <Badge variant="secondary">{t("agentDetail.archived")}</Badge> : <AgentStatusBadge status={agent.status} />}
        </span>
      )}
      {children}
      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-xs" aria-label={t("agentDetail.openAgentActions", { name: agent.name })}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="end">
          <button
            className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50"
            disabled={duplicateAgent.isPending}
            onClick={handleDuplicateAgent}
          >
            {duplicateAgent.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
            {t("agentDetail.duplicateAgentTitle")}
          </button>
          <button
            className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50"
            onClick={() => {
              void copyTextToClipboard(agent.id).catch(() => {
                pushToast({ title: t("agentDetail.copyFailed"), body: t("agentDetail.clipboardUnavailable"), tone: "error" });
              });
              setMoreOpen(false);
            }}
          >
            <Copy className="h-3 w-3" />
            {t("agentDetail.copyAgentId")}
          </button>
          <button
            className="flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50"
            onClick={() => {
              resetTaskSession.mutate();
              setMoreOpen(false);
            }}
          >
            <RotateCcw className="h-3 w-3" />
            {t("agentDetail.resetSessionsTitle")}
          </button>
          {stopMenuItem("flex items-center gap-2 w-full px-2 py-1.5 text-xs rounded hover:bg-accent/50", "h-3 w-3")}
        </PopoverContent>
      </Popover>
      {lifecycleDialog}
    </div>
  );
}
