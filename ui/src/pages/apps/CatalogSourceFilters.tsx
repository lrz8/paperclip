import { useTranslation } from "@/i18n";
import { TabFilters } from "@/components/TabBar";

export const CATALOG_SOURCES = ["paperclip", "composio", "arcade", "installed", "all"] as const;
export type CatalogSource = typeof CATALOG_SOURCES[number];
export const CATALOG_SOURCE_NAMES = { paperclip: "Paperclip", composio: "Composio", arcade: "Arcade", executor: "Executor", installed: "Installed", all: "All" };

export function CatalogSourceFilters({ source, onChange }: { source: CatalogSource; onChange: (source: CatalogSource) => void }) {
  const { t } = useTranslation();
  return <TabFilters label={t("apps.filters")} size="standard" items={CATALOG_SOURCES.map(value => ({ value, label: value === "all" ? t("common.all") : value === "installed" ? t("apps.installed") : CATALOG_SOURCE_NAMES[value] }))} value={source} onValueChange={onChange} />;
}
