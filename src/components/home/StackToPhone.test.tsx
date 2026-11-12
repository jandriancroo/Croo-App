import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import StackToPhone, { STACK_SCROLL_CSS } from "./StackToPhone";
import { STACK_TOOLS, stackFrame } from "./stackFrames";

describe("stack to phone", () => {
  it("renders the seven tools, the phone brand, and a sample dashboard", () => {
    const { container } = render(<StackToPhone />);
    expect(screen.getByRole("heading", { name: /Seven apps out/i })).toBeTruthy();
    for (const tool of STACK_TOOLS) expect(screen.getByText(tool)).toBeTruthy();
    expect(screen.getByText("One app. Every store.")).toBeTruthy();
    expect(screen.getByAltText("CrooHQ")).toHaveAttribute("src", "/croohq-wordmark.png");
    expect(screen.getByText("Quick Tasks")).toBeTruthy();
    expect(screen.getByText("Restock the line")).toBeTruthy();
    expect(screen.getByText("Log the cooler temp")).toBeTruthy();
    expect(screen.getByText("Opening")).toBeTruthy();
    expect(screen.getByText("Mid-shift")).toBeTruthy();
    expect(screen.getByText("Closing")).toBeTruthy();
    expect(screen.getByText("$4,812")).toBeTruthy();
    expect(screen.getByText("$4,390")).toBeTruthy();
    expect(screen.getByText("$5,000")).toBeTruthy();
    expect(screen.getByText("$5,240")).toBeTruthy();
    expect(screen.getAllByText("Example")).toHaveLength(1);
    expect(screen.queryByText(/sample data/i)).toBeNull();
    expect(container.textContent).not.toMatch(/Toast|Clover|Aloha|rip and replace|rip-and-replace/i);
  });

  it("walks the five scroll frames on desktop and stacks the phone on a narrow screen", () => {
    const start = stackFrame(0.02, false);
    expect(start.list).toBe(1);
    expect(start.x).toBe(0);
    expect(start.dash).toBe(0);
    expect(start.phone).toBe(1);

    const cover = stackFrame(0.26, false);
    expect(cover.x).toBeLessThan(-100);
    expect(cover.list).toBeLessThan(0.6);

    const alone = stackFrame(0.48, false);
    expect(alone.all).toBe(1);
    expect(alone.x).toBe(0);
    expect(alone.dash).toBe(0);
    expect(alone.list).toBe(0);

    const dash = stackFrame(0.68, false);
    expect(dash.dash).toBe(1);
    expect(dash.zoom).toBe(1);
    expect(dash.all).toBeGreaterThan(0.8);

    const zoom = stackFrame(1, false);
    expect(zoom.zoom).toBe(1);
    expect(zoom.y).toBe(0);
    expect(zoom.x).toBe(0);
    expect(zoom.dash).toBe(1);

    const mobileStart = stackFrame(0, true);
    expect(mobileStart.phone).toBe(0);
    expect(mobileStart.list).toBe(1);
    const mobilePhone = stackFrame(0.4, true);
    expect(mobilePhone.phone).toBe(1);
    expect(mobilePhone.list).toBe(0);
    expect(stackFrame(0.7, true).dash).toBe(1);
    expect(STACK_SCROLL_CSS).toContain("margin-top:64px");
    expect(STACK_SCROLL_CSS).not.toContain("margin-top:-");
  });
});
