import { NativeSelect } from "@/components/ui/select";
import { setLanguage, useTranslation } from "@/i18n";

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  return (
    <NativeSelect
      className="w-auto text-base md:text-sm"
      aria-label={t("common.language")}
      value={i18n.resolvedLanguage === "zh-CN" ? "zh-CN" : "en"}
      onChange={(event) => {
        const language = event.currentTarget.value;
        if (language === "en" || language === "zh-CN") void setLanguage(language);
      }}
    >
      <option value="en" lang="en">English</option>
      <option value="zh-CN" lang="zh-CN">简体中文</option>
    </NativeSelect>
  );
}
