import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Issue } from "@paperclipai/shared";
import { issuesApi } from "@/api/issues";
import { IssueDeletionImpactDialog } from "@/components/IssueDeletionImpactDialog";
import { canArchiveTask, TaskLifecycleMenu } from "@/components/TaskLifecycleMenu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToastActions } from "@/context/ToastContext";
import { useAccountBoundMutation } from "@/hooks/useAccountBoundMutation";
import { useTranslation } from "@/i18n";
import { queryKeys } from "@/lib/queryKeys";

export function useTaskLifecycle(companyId: string | null, archived = false, onDeleted = () => {}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { pushToast } = useToastActions();
  const [target, setTarget] = useState<Issue | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setSelecting(false);
    setSelection(new Set());
    setTarget(null);
  }, [companyId, archived]);

  const invalidate = () => companyId
    ? client.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) })
    : Promise.resolve();
  const archive = useAccountBoundMutation({
    mutationFn: async ({ ids, toArchive }: { ids: string[]; toArchive: boolean }, { assertCurrentAccount }) => {
      // Process independently so one late work start does not undo successful
      // changes to other selected rows.
      const failed: string[] = [];
      for (const id of ids) {
        assertCurrentAccount();
        try {
          await issuesApi.archiveTask(id, toArchive);
        } catch (error) {
          failed.push(id);
          if (ids.length === 1) throw error;
        }
      }
      return failed;
    },
    onSuccess: async (failed, { ids }) => {
      setSelection(new Set(failed));
      if (failed.length === 0) setSelecting(false);
      if (failed.length) pushToast({
        title: t("taskLifecycle.batchPartial", { changed: ids.length - failed.length, failed: failed.length }),
        tone: "warn",
      });
      await Promise.all([
        invalidate(),
        ...ids.map((id) => client.invalidateQueries({ queryKey: queryKeys.issues.detail(id) })),
      ]);
    },
    onError: (error) => {
      pushToast({
        title: t("taskLifecycle.archiveFailed"),
        body: error instanceof Error ? error.message : undefined,
        tone: "error",
      });
    },
  });
  function changeArchive(issue: Issue) {
    archive.mutate({ ids: [issue.id], toArchive: !issue.taskArchivedAt }, {
      onSuccess: () => { if (issue.identifier) void client.invalidateQueries({ queryKey: queryKeys.issues.detail(issue.identifier) }); },
    });
  }
  const rowActions = (issue: Issue) => (
    <>
      {selecting && canArchiveTask(issue) ? (
        <Checkbox checked={selection.has(issue.id)} disabled={archive.isPending}
          aria-label={t("taskLifecycle.selectTask", { title: issue.title })}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={(checked) => setSelection((current) => {
            const next = new Set(current);
            if (checked) next.add(issue.id); else next.delete(issue.id);
            return next;
          })} />
      ) : null}
      <TaskLifecycleMenu issue={issue} pending={archive.isPending} onArchive={changeArchive} onDelete={setTarget} />
    </>
  );
  const batchControls = (
    <>
      <Button size="sm" variant="outline" disabled={archive.isPending}
        onClick={() => {
          setSelecting(!selecting);
          setSelection(new Set());
        }}>
        {t(selecting ? "common.cancel" : "taskLifecycle.select")}
      </Button>
      {selecting ? (
        <Button size="sm" variant="outline" disabled={!selection.size || archive.isPending}
          onClick={() => archive.mutate({ ids: [...selection], toArchive: !archived })}>
          {t(archived ? "taskLifecycle.restoreSelected" : "taskLifecycle.archiveSelected", { count: selection.size })}
        </Button>
      ) : null}
    </>
  );
  const dialog = target ? (
    <IssueDeletionImpactDialog issueId={target.id} title={target.title}
      onClose={() => setTarget(null)} onDeleted={onDeleted} />
  ) : null;
  return { changeArchive, pending: archive.isPending, rowActions, batchControls, requestDelete: setTarget, dialog };
}
