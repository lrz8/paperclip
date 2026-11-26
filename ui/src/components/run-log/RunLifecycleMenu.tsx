import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import type { HeartbeatRun } from "@paperclipai/shared";
import { heartbeatsApi } from "@/api/heartbeats";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToastActions } from "@/context/ToastContext";
import { useTranslation } from "@/i18n";
import { queryKeys } from "@/lib/queryKeys";

type Action = Parameters<typeof heartbeatsApi.changeLifecycle>[1];

export function canArchiveRun(run: HeartbeatRun) {
  return !run.redacted && Boolean(run.finishedAt) && ["succeeded", "failed", "cancelled", "timed_out"].includes(run.status);
}

export function useRunLifecycleAction(companyId: string) {
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: async ({ action, runIds }: { action: Action; runIds: string[] }) => {
      const failures: unknown[] = [];
      for (const id of runIds) {
        try {
          await heartbeatsApi.changeLifecycle(id, action);
        } catch (error) {
          failures.push(error);
        }
      }
      return failures;
    },
    onSuccess: async (failures, { runIds }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["audit", companyId, "runs"] }),
        queryClient.invalidateQueries({ queryKey: ["heartbeats", companyId] }),
        ...runIds.map((id) => queryClient.invalidateQueries({ queryKey: queryKeys.runDetail(id) })),
      ]);
      if (failures.length) {
        pushToast({
          title: t("runLifecycle.updateFailed", { count: failures.length }),
          body: failures[0] instanceof Error ? failures[0].message : undefined,
          tone: "error",
        });
      }
    },
  });
}

export function RunLifecycleMenu({ run, detail = false }: { run: HeartbeatRun; detail?: boolean }) {
  const { t } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const action = useRunLifecycleAction(run.companyId);
  if (run.redacted || (!run.archivedAt && !canArchiveRun(run))) return null;
  const canPurge = detail && run.archivedAt && run.logStore === "local_file" && run.logRef && run.logBytes != null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" disabled={action.isPending} aria-label={t("runLifecycle.actions")}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => action.mutate({ action: run.archivedAt ? "restore" : "archive", runIds: [run.id] })}>
            {t(run.archivedAt ? "runLifecycle.restore" : "runLifecycle.archive")}
          </DropdownMenuItem>
          {canPurge && <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>{t("runLifecycle.purge")}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("runLifecycle.purge")}</AlertDialogTitle>
            <AlertDialogDescription>{t("runLifecycle.purgeImpact", { bytes: run.logBytes ?? 0 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={action.isPending}>{t("common.cancel")}</AlertDialogCancel>
            <Button variant="destructive" disabled={action.isPending} onClick={() => {
              action.mutate({ action: "purge-log", runIds: [run.id] }, {
                onSuccess: (failures) => { if (!failures.length) setConfirmOpen(false); },
              });
            }}>{t("runLifecycle.purgeConfirm")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
