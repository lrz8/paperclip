// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { i18n, useTranslation } from "@/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.removeItem("paperclip.language");
});

it("updates the interface, accessibility language, and saved preference when the language changes", async () => {
  function Example() {
    const { t } = useTranslation();
    return <><LanguageSwitcher /><h1>{t("auth.signInTitle")}</h1></>;
  }

  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Example />));
    const select = container.querySelector("select")!;
    expect(container.querySelector("h1")?.textContent).toBe("Sign in to Paperclip");

    for (const [language, heading] of [["zh-CN", "登录 Paperclip"], ["en", "Sign in to Paperclip"]]) {
      await act(async () => {
        select.value = language;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(container.querySelector("h1")?.textContent).toBe(heading);
      expect(select.value).toBe(language);
      expect(document.documentElement.lang).toBe(language);
      expect(localStorage.getItem("paperclip.language")).toBe(language);
    }
  } finally {
    await act(async () => root.unmount());
  }
});
