import { useState } from "react";
import type { Agent, Issue } from "@paperclipai/shared";
import { useTranslation } from "@/i18n";
import { Link } from "@/lib/router";
import { AgentConversationActions, useUpdateAgentConversation } from "./AgentConversationActions";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/select";

export function AgentConversationHistory({ chats, agents, userId }: { chats: Issue[]; agents: Agent[]; userId: string | null }) {
  const { t } = useTranslation();
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ succeeded: number; failed: number } | null>(null);
  const update = useUpdateAgentConversation(userId);
  const names = new Map(agents.map(agent => [agent.id, agent.name]));
  const searchTerm = query.trim().toLocaleLowerCase();
  const rows = chats.filter(chat => Boolean(chat.hiddenAt) === archived
    && `${chat.title} ${names.get(chat.conversationAgentId ?? "") ?? ""}`.toLocaleLowerCase().includes(searchTerm));
  const targets = rows.filter(row => selected.has(row.id));

  async function applyArchive() {
    const failed = new Set<string>();
    setBusy(true);
    setFeedback(null);
    for (const chat of targets) {
      try {
        await update(chat, { issueId: chat.id, archived: !archived });
      } catch {
        failed.add(chat.id);
      }
    }
    setSelected(failed);
    setFeedback({ succeeded: targets.length - failed.size, failed: failed.size });
    setBusy(false);
  }

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <h1 className="text-lg font-semibold">{t("conversationLifecycle.history")}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <Input className="min-w-32 flex-1" aria-label={t("conversationLifecycle.search")} placeholder={t("conversationLifecycle.search")}
          value={query} onChange={event => { setQuery(event.target.value); setSelected(new Set()); setFeedback(null); }} disabled={busy} />
        <NativeSelect className="w-auto" aria-label={t("conversationLifecycle.filter")} value={archived ? "archived" : "active"}
          onChange={event => { setArchived(event.target.value === "archived"); setSelected(new Set()); setFeedback(null); }} disabled={busy}>
          <option value="active">{t("conversationLifecycle.active")}</option>
          <option value="archived">{t("conversationLifecycle.archivedFilter")}</option>
        </NativeSelect>
      </div>
      {rows.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(targets.length === rows.length ? new Set() : new Set(rows.map(row => row.id)))} disabled={busy}>
          {targets.length === rows.length ? t("conversationLifecycle.clearSelection") : t("conversationLifecycle.selectAll")}
        </Button>
        {targets.length > 0 && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void applyArchive(); }}>
          {archived ? t("conversationLifecycle.restoreSelected", { count: targets.length }) : t("conversationLifecycle.archiveSelected", { count: targets.length })}
        </Button>}
      </div>}
      {feedback && <p role="status" className="text-sm text-muted-foreground">{t("conversationLifecycle.bulkResult", feedback)}</p>}
      {rows.length ? <ul className="divide-y divide-border rounded-md border border-border">
        {rows.map(chat => <li key={chat.id} className="flex items-center gap-3 px-3 py-2">
          <Checkbox checked={selected.has(chat.id)} disabled={busy} aria-label={t("conversationLifecycle.selectConversation", { title: chat.title })}
            onCheckedChange={checked => setSelected(current => {
              const next = new Set(current);
              if (checked) next.add(chat.id);
              else next.delete(chat.id);
              return next;
            })} />
          <Link className="min-w-0 flex-1 rounded-md px-2 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to={`/chats/${encodeURIComponent(chat.conversationAgentId ?? "")}`}>
            <span className="block truncate text-sm font-medium">{chat.title}</span>
            <span className="block truncate text-xs text-muted-foreground">{names.get(chat.conversationAgentId ?? "")}</span>
          </Link>
          {!busy && <AgentConversationActions issue={chat} userId={userId} />}
        </li>)}
      </ul> : <p className="text-sm text-muted-foreground">{t("conversationLifecycle.empty")}</p>}
    </section>
  );
}
