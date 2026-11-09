import { describe, expect, it } from "vitest";
import { toastLinkView } from "./toastUserLinks";

describe("toastLinkView", () => {
  const users = [
    { id: "kayla", is_active: true },
    { id: "dolly", is_active: true },
    { id: "dolly-2", is_active: true },
    { id: "michael", is_active: true },
    { id: "lora", is_active: true },
    { id: "invite", is_active: true },
    { id: "former", is_active: false },
  ];

  it("counts only active roster rows that would receive a badge", () => {
    const view = toastLinkView(users, ["kayla", "michael", "invite", "former", "not-on-roster"]);
    const active = users.filter((user) => user.is_active);
    const badged = active.filter((user) => view.isLinked(user.id));
    expect(badged.map((user) => user.id)).toEqual(["kayla", "michael", "invite"]);
    expect(view.linkedCount).toBe(badged.length);
    expect(view.activeCount).toBe(active.length);
    expect(view.statusText).toBe("3 of 6 linked to Toast");
    expect(view.isLinked("former")).toBe(true);
    expect(view.isLinked("dolly")).toBe(false);
    expect(view.isLinked("not-on-roster")).toBe(false);
  });
});