import type { IssueBlockerAttention } from "@paperclipai/shared";
import { t } from "@/i18n";

/**
 * Everything a task status surface needs to pick its glyph and label. Every
 * view (sidebar rows, task header, properties, status picker, lists, inbox,
 * pills, search) resolves through {@link resolveTaskStatusPresentation}, so one
 * underlying state always renders the same icon and label (BUG-07).
 */
export interface TaskStatusPresentationInput {
  status: string;
  /** Server-derived presentation; mutations still use the canonical status. */
  displayStatus?: string | null;
  externalConversationState?: "active" | "waiting" | null;
  blockerAttention?: IssueBlockerAttention | null;
}

export interface TaskStatusPresentation {
  /** Key into the unified StatusGlyph icon/colour tables. */
  glyphStatus: string;
  /** Short visible label ("Blocked", "Idle", "Monitoring", …). */
  label: string;
  /** Full accessible/tooltip copy, including the blocked reason. */
  ariaLabel: string;
}

export function taskStatusLabel(status: string): string {
  return t(`taskStatus.${status}`, { defaultValue: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) });
}

function blockedAttentionLabel(blockerAttention: IssueBlockerAttention | null | undefined) {
  if (!blockerAttention || blockerAttention.state === "none") return taskStatusLabel("blocked");

  if (blockerAttention.reason === "active_child") {
    const count = blockerAttention.coveredBlockerCount;
    if (count === 1 && blockerAttention.sampleBlockerIdentifier) {
      return t("taskStatus.activeChildItem", { task: blockerAttention.sampleBlockerIdentifier });
    }
    return t("taskStatus.activeChildCount", { count });
  }

  if (blockerAttention.reason === "active_dependency") {
    const count = blockerAttention.coveredBlockerCount;
    if (count === 1 && blockerAttention.sampleBlockerIdentifier) {
      return t("taskStatus.activeDependencyItem", { task: blockerAttention.sampleBlockerIdentifier });
    }
    return t("taskStatus.activeDependencyCount", { count });
  }

  if (blockerAttention.reason === "stalled_review") {
    const count = blockerAttention.stalledBlockerCount;
    const leaf = blockerAttention.sampleStalledBlockerIdentifier ?? blockerAttention.sampleBlockerIdentifier;
    if (count === 1 && leaf) return t("taskStatus.stalledReviewItem", { task: leaf });
    if (count === 1) return t("taskStatus.stalledReview");
    return t("taskStatus.stalledReviews", { count });
  }

  if (blockerAttention.reason === "attention_required") {
    const count = blockerAttention.attentionBlockerCount || blockerAttention.unresolvedBlockerCount;
    const coveredCount = blockerAttention.coveredBlockerCount;
    return coveredCount > 0
      ? t("taskStatus.needsAttentionCovered", { count, coveredCount })
      : t("taskStatus.needsAttention", { count });
  }

  return taskStatusLabel("blocked");
}

/**
 * The one state → glyph/label mapping:
 * - in_review whose external conversation is waiting → "Idle"
 * - in_progress presented as monitoring → "Monitoring" (clock)
 * - blocked and covered by active work → the blue "in queue" glyph, with the
 *   blocked reason on the accessible label
 */
export function resolveTaskStatusPresentation(input: TaskStatusPresentationInput): TaskStatusPresentation {
  const { status, displayStatus, externalConversationState, blockerAttention } = input;
  // A saved/optimistic transition must win over the previous read projection.
  const projectedStatus = status === "in_progress" ? (displayStatus ?? status) : status;
  const visibleStatus = projectedStatus === "in_review" && externalConversationState === "waiting"
    ? "idle"
    : projectedStatus;
  const isCoveredBlocked = projectedStatus === "blocked" && blockerAttention?.state === "covered";
  return {
    glyphStatus: isCoveredBlocked ? "in_queue" : visibleStatus,
    label: taskStatusLabel(visibleStatus),
    ariaLabel: projectedStatus === "blocked" ? blockedAttentionLabel(blockerAttention) : taskStatusLabel(visibleStatus),
  };
}

type TaskStatusSource = {
  status: string;
  displayStatus?: string | null;
  externalConversationState?: "active" | "waiting" | null;
  blockerAttention?: IssueBlockerAttention | null;
};

/**
 * Pick every status-presentation field from a task record so a view cannot
 * silently drop one (e.g. `blockerAttention`) and render a different glyph
 * than the task pane. Spread into `<StatusIcon {...taskStatusIconProps(task)} />`.
 */
export function taskStatusIconProps(task: TaskStatusSource): TaskStatusPresentationInput {
  return {
    status: task.status,
    displayStatus: task.displayStatus ?? null,
    externalConversationState: task.externalConversationState ?? null,
    blockerAttention: task.blockerAttention ?? null,
  };
}
