import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";

const tabs = ["all", "archived", "terminated"] as const;

export function AgentLifecycleFilter({ active }: { active: typeof tabs[number] }) {
  const { t } = useTranslation();
  return (
    <div role="group" aria-label={t("agents.lifecycleFilter")} className="flex flex-wrap gap-1">
      {tabs.map(tab => (
        <Button key={tab} asChild size="sm" variant={active === tab ? "secondary" : "ghost"}>
          <Link to={`/agents/${tab}`} aria-current={active === tab ? "page" : undefined}>{t(`agents.lifecycleTabs.${tab}`)}</Link>
        </Button>
      ))}
    </div>
  );
}
