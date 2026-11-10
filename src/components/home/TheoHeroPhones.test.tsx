import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import TheoHeroPhones from "./TheoHeroPhones";
import { THEO_HERO_CSS, THEO_HEADLINE, chatStartMs, LOOP_MS, PLATFORM_MS, THEO_MS, CHAT_MS, SALES_LAG_MS } from "./theoHeroMotion";

describe("Theo hero phones", () => {
  it("renders both sample chats with no prices or vendor names", () => {
    const { container } = render(<TheoHeroPhones />);
    expect(screen.getAllByText("Sample interaction")).toHaveLength(2);
    expect(screen.getByText("Hey, can you get this shift covered for me?")).toBeTruthy();
    expect(screen.getByText("On it. I sent the open shift to available crew. Alex picked it up, so you're covered.")).toBeTruthy();
    expect(screen.getByText("Where are sales gonna land by the end of the night?")).toBeTruthy();
    expect(screen.getByText("You're looking really strong. Keep up the momentum, and make sure we're keeping customer service great.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\$|Toast|Clover|Aloha|rip and replace|rip-and-replace/i);
  });

  it("keeps the 31s loop, with the sales chat 1.5s behind on desktop and sequential on mobile", () => {
    expect(PLATFORM_MS + THEO_MS).toBe(LOOP_MS);
    expect(LOOP_MS).toBe(31_000);
    expect(chatStartMs("shift", false)).toBe(15_000);
    expect(chatStartMs("sales", false) - chatStartMs("shift", false)).toBe(SALES_LAG_MS);
    expect(chatStartMs("sales", true) - chatStartMs("shift", true)).toBe(CHAT_MS);
    expect(THEO_HEADLINE).toBe("Theo, a manager's best friend");
    expect(THEO_HERO_CSS).toContain("theo-sales-ask-m");
    expect(THEO_HERO_CSS).toContain("prefers-reduced-motion");
  });
});
