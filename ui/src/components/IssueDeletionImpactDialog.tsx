import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { issuesApi } from "@/api/issues";
import { useTranslation } from "@/i18n";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "./ui/button";
import {
  AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel,
} from "./ui/alert-dialog";

export function IssueDeletionImpactDialog({ issueId, title, onClose, onDeleted }: {
  issueId: string | null;
  title: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const impact = useQuery({
    queryKey: ["issue-deletion-impact", issueId],
    queryFn: () => issuesApi.deletionImpact(issueId!),
    enabled: !!issueId,
    retry: false,
  });
  const remove = useMutation({
    mutationFn: (id: string) => issuesApi.remove(id),
    onSuccess: async (removed) => {
      onClose();
      onDeleted();
      await client.invalidateQueries({ queryKey: queryKeys.issues.list(removed.companyId) });
    },
    onError: () => { void impact.refetch(); },
  });
  return (
    <AlertDialog open={!!issueId} onOpenChange={(open) => {
      if (!open && !remove.isPending) {
        remove.reset();
        onClose();
      }
    }}>
      <AlertDialogContent>
        <AlertDialogTitle>{t("taskLifecycle.deleteTitle", { title })}</AlertDialogTitle>
        <AlertDialogDescription>{t("taskLifecycle.deleteDescription")}</AlertDialogDescription>
        {impact.isFetching && !impact.data ? <p role="status">{t("taskLifecycle.loadingImpact")}</p> : null}
        {impact.error || remove.error ? <p role="alert" className="text-sm text-destructive">{t("taskLifecycle.deleteFailed")}</p> : null}
        {impact.data ? (
          <div className="space-y-2 text-sm">
            <p>{t("taskLifecycle.deletionCounts", {
              ...impact.data,
              attachmentBytes: new Intl.NumberFormat(i18n.language).format(impact.data.attachmentBytes),
            })}</p>
            <p className="text-muted-foreground">{t("taskLifecycle.deletionRetained")}</p>
            {impact.data.blockers.length > 0 ? (
              <ul className="list-disc space-y-1 ps-5 text-destructive">
                {impact.data.blockers.map((blocker) => <li key={blocker}>{t(`taskLifecycle.blockers.${blocker}`)}</li>)}
              </ul>
            ) : null}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t("common.cancel")}</AlertDialogCancel>
          <Button variant="destructive" disabled={!impact.data || impact.data.blockers.length > 0 || impact.isFetching || !!impact.error || remove.isPending}
            onClick={() => { if (issueId) remove.mutate(issueId); }}>
            {t("taskLifecycle.delete")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
