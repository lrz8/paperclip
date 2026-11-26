import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Ellipsis, Pencil, Trash2 } from "lucide-react";
import type { Issue, UpdateAgentConversation } from "@paperclipai/shared";
import { agentChatsApi } from "@/api/agentChats";
import { ApiError } from "@/api/client";
import { useToastActions } from "@/context/ToastContext";
import { rememberChat } from "@/hooks/useAgentChatNavigation";
import { useTranslation } from "@/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { IssueDeletionImpactDialog } from "./IssueDeletionImpactDialog";

export function useUpdateAgentConversation(userId: string | null) {
  const client = useQueryClient();
  return async (issue: Issue, change: UpdateAgentConversation) => {
    if (!issue.conversationAgentId) return;
    const updated = await agentChatsApi.update(issue.companyId, issue.conversationAgentId, change);
    const existingDetail = client.getQueryData<Issue>(queryKeys.issues.detail(issue.id));
    rememberChat(client, issue.companyId, userId, issue.conversationAgentId, updated);
    if (existingDetail) client.setQueryData(queryKeys.issues.detail(issue.id), { ...existingDetail, ...updated });
    void client.invalidateQueries({ queryKey: queryKeys.issues.detail(issue.id) });
  };
}

export function AgentConversationActions({ issue, userId, onDeleted }: { issue: Issue; userId: string | null; onDeleted?: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const { pushToast } = useToastActions();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(issue.title);
  const update = useUpdateAgentConversation(userId);
  const mutation = useMutation({
    mutationFn: (change: UpdateAgentConversation) => update(issue, change),
    onSuccess: (_result, change) => {
      setRenaming(false);
      pushToast({ title: "title" in change ? t("conversationLifecycle.renamed") : change.archived
        ? t("conversationLifecycle.archived") : t("conversationLifecycle.restored"), tone: "success" });
    },
    onError: error => pushToast({
      title: error instanceof ApiError && (error.body as { code?: string } | null)?.code === "conversation_pending_turn"
        ? t("conversationLifecycle.pendingTurn") : t("conversationLifecycle.saveFailed"),
      tone: "error",
    }),
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={t("conversationLifecycle.actions", { title: issue.title })} disabled={mutation.isPending}>
            <Ellipsis className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => { setName(issue.title); setRenaming(true); }}>
            <Pencil className="size-4" aria-hidden />{t("conversationLifecycle.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => mutation.mutate({ issueId: issue.id, archived: !issue.hiddenAt })}>
            {issue.hiddenAt ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
            {issue.hiddenAt ? t("common.restore") : t("common.archive")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={!issue.hiddenAt} onSelect={() => setDeleting(true)}>
            <Trash2 className="size-4" aria-hidden />{t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={open => { if (!mutation.isPending) setRenaming(open); }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{t("conversationLifecycle.rename")}</DialogTitle></DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={event => {
            event.preventDefault();
            if (name.trim() && !mutation.isPending) mutation.mutate({ issueId: issue.id, title: name });
          }}>
            <Label className="flex flex-col items-start gap-2">
              {t("conversationLifecycle.title")}
              <Input value={name} maxLength={240} onChange={event => setName(event.target.value)} disabled={mutation.isPending} />
            </Label>
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="ghost" onClick={() => setRenaming(false)} disabled={mutation.isPending}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={!name.trim() || mutation.isPending}>{t("common.save")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      {deleting && <IssueDeletionImpactDialog issueId={issue.id} title={issue.title} onClose={() => setDeleting(false)} onDeleted={() => {
        setDeleting(false);
        client.setQueryData<Issue[]>(queryKeys.agentChats.list(issue.companyId, userId), items => items?.filter(item => item.id !== issue.id));
        client.setQueryData(queryKeys.agentChats.detail(issue.companyId, userId, issue.conversationAgentId ?? undefined), null);
        void client.invalidateQueries({ queryKey: queryKeys.agentChats.list(issue.companyId, userId) });
        onDeleted?.();
      }} />}
    </>
  );
}
