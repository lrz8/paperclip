import { Archive, ArchiveRestore, MoreHorizontal, Trash2 } from "lucide-react";
import type { Issue } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export function canArchiveTask(issue: Issue) {
  return issue.status === "done" || issue.status === "cancelled";
}

export function TaskLifecycleMenu({ issue, pending, onArchive, onDelete }: {
  issue: Issue;
  pending: boolean;
  onArchive: (issue: Issue) => void;
  onDelete: (issue: Issue) => void;
}) {
  const { t } = useTranslation();
  if (issue.conversationAgentId || (!issue.taskArchivedAt && !canArchiveTask(issue))) return null;
  const Icon = issue.taskArchivedAt ? ArchiveRestore : Archive;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" disabled={pending} aria-label={t("taskLifecycle.actions")}
          onClick={(event) => event.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuItem onSelect={() => onArchive(issue)}>
          <Icon className="size-4" />
          {t(issue.taskArchivedAt ? "taskLifecycle.restore" : "taskLifecycle.archive")}
        </DropdownMenuItem>
        {issue.taskArchivedAt ? (
          <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(issue)}>
            <Trash2 className="size-4" />
            {t("taskLifecycle.delete")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
