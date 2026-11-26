import { useTranslation } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import type { AiManagedConnectionSummary, ConnectionGrant } from "@paperclipai/shared";
import { aiConnectionsApi } from "@/api/ai-connections";
import { describeError } from "@/api/errors";
import { retryTransientOnly } from "@/lib/query-client";
import { Button } from "@/components/ui/button";
import { AI_PROVIDERS, aiMethodLabel } from "./model";
import { ANALYTICS_MASK_CLASS } from "@/lib/analytics/privacy";
import { cn } from "@/lib/utils";

/** Provider profile loading is independent of account access and maintenance controls. */
export function AiConnectionAccountDetails({ account, grant }: {
  account: AiManagedConnectionSummary;
  grant: ConnectionGrant;
}) {
  const { t } = useTranslation();
  const isChatGpt = account.provider === "openai" && account.method === "subscription" && !account.routing;
  const canLookUp = !account.routing && (account.provider === "anthropic" || isChatGpt) && account.method === "subscription" && account.status === "connected";
  const identity = useQuery({
    queryKey: ["ai-account-identity", account.companyId, account.id, grant.id, grant.updatedAt],
    queryFn: ({ signal }) => aiConnectionsApi.accountIdentity(account.companyId, account.id, grant.id, { signal }),
    enabled: canLookUp,
    staleTime: 5 * 60_000,
    retry: retryTransientOnly(0),
  });
  const accountLabel = identity.data?.accountLabel ?? account.accountLabel;
  const message = identity.error ? describeError(identity.error).body : identity.data?.message;
  const retryable = identity.isError || identity.data?.status === "error";
  return (
    <section className="space-y-3" aria-label={t("connections.connectedAccount")}>
      <h3 className="text-sm font-semibold">{t("connections.connectedAccount")}</h3>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <dt className="text-muted-foreground">{t("connections.providerAccount", { provider: AI_PROVIDERS[account.provider].name })}</dt>
        <dd className={cn("break-words", ANALYTICS_MASK_CLASS)}>{accountLabel ?? t("connections.notAvailable")}</dd>
        {(isChatGpt || identity.data?.organizationLabel) && <>
          <dt className="text-muted-foreground">{isChatGpt ? t("connections.chatGptWorkspace") : t("nav.organization")}</dt>
          <dd className={cn("break-words", ANALYTICS_MASK_CLASS)}>{identity.data?.organizationLabel ?? (identity.isPending && canLookUp ? t("connections.checking") : t("connections.notAvailable"))}</dd>
        </>}
        <dt className="text-muted-foreground">{t("connections.signInMethod")}</dt>
        <dd>{aiMethodLabel(account.provider, account.method)}</dd>
        <dt className="text-muted-foreground">{t("connections.accountAccess")}</dt>
        <dd>{account.ownership === "shared" ? t("connections.sharedAccount") : t("connections.personalOwnedAccount", { owner: account.ownerName ?? t("connections.accountOwner") })}</dd>
      </dl>
      {canLookUp && identity.isPending && <p role="status" className="text-xs text-muted-foreground">{t("connections.checkingAccount")}</p>}
      {message && <p role={retryable ? "alert" : undefined} className="text-xs text-muted-foreground">{message}</p>}
      {retryable && <Button variant="outline" size="sm" disabled={identity.isFetching} onClick={() => void identity.refetch()}>{t("connections.retryAccount")}</Button>}
    </section>
  );
}
