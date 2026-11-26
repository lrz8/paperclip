import { describe, expect, it } from "vitest";
import { agentRouteRef, agentUrl } from "./utils";

describe("Agent route references", () => {
  it("keeps terminated Agent history on the persistent UUID", () => {
    const agent = { id: "9a49ae56-9754-49d2-81f8-b92793cbdeb0", urlKey: "reviewer", status: "terminated" };
    expect(agentRouteRef(agent)).toBe(agent.id);
    expect(agentUrl(agent)).toBe(`/agents/${agent.id}`);
    expect(agentUrl({ ...agent, status: "paused" })).toBe("/agents/reviewer");
  });
});
