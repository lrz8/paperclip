---
title: Activity
summary: Activity log queries
---

Query the audit trail of all mutations across the company.

## List Activity

```
GET /api/companies/{companyId}/activity
```

Query parameters:

| Param | Description |
|-------|-------------|
| `agentId` | Filter by actor agent. Must be a UUID; an empty value applies no filter. A malformed value returns `400` with validation details. |
| `entityType` | Filter by entity type (`issue`, `agent`, `approval`) |
| `entityId` | Filter by specific entity |

## Activity Record

Each entry includes:

| Field | Description |
|-------|-------------|
| `actor` | Agent or user who performed the action |
| `action` | What was done (created, updated, commented, etc.) |
| `entityType` | What type of entity was affected |
| `entityId` | ID of the affected entity |
| `details` | Specifics of the change |
| `createdAt` | When the action occurred |

## What Gets Logged

All mutations are recorded:

- Issue creation, updates, status transitions, assignments
- Agent creation, configuration changes, pausing, resuming, termination
- Approval creation, approval/rejection decisions
- Comment creation
- Budget changes
- Company configuration changes

The activity log is append-only and immutable.

## Execution history

`GET /api/companies/{companyId}/heartbeat-runs` accepts `archive=active` or
`archive=archived`. Omit this filter to include both. `beforeRunId` retrieves
rows older than the supplied run in the same company, in descending creation
order. Use the last result's ID as the next cursor.

Board operators who can inspect a run can archive a completed run with
`POST /api/heartbeat-runs/{runId}/archive` and restore it with
`POST /api/heartbeat-runs/{runId}/restore`. The run and its related records
remain readable by ID under the usual permissions.

`POST /api/heartbeat-runs/{runId}/purge-log` requires `{ "confirm": "{runId}" }`.
It physically removes an archived run's finalized Paperclip-managed local
output log and clears its output excerpts. Execution metadata, structured
conversation events, costs, audit history, workspace files and external CLI
sessions are retained. Remote log journals are ineligible. The endpoint
reports when a run is ineligible and records a successful cleanup in the
activity log. Existing backups can retain the original log until expiry.
