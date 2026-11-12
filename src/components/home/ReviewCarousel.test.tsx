import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewCarousel, { JOHNNY_QUOTE } from "./ReviewCarousel";
import type { PublicReview } from "@/lib/customerReviewsApi";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const newer: PublicReview = {
  id: "new",
  createdAt: "2026-11-02T00:00:00Z",
  text: "Newest words from a real operator.",
  attribution: "Newer Owner, GM, North Store",
};
const older: PublicReview = {
  id: "old",
  createdAt: "2026-10-01T00:00:00Z",
  text: "Older words from a real operator.",
  attribution: "Older Owner, GM, South Store",
};

describe("homepage review carousel", () => {
  it("keeps Johnny's quote when the review fetch fails", async () => {
    render(<ReviewCarousel load={() => Promise.reject(new Error("down"))} />);
    expect(await screen.findByText(JOHNNY_QUOTE)).toBeTruthy();
    expect(screen.getByText("Johnny Tellez")).toBeTruthy();
    expect(screen.queryByText(newer.text)).toBeNull();
    expect(screen.getByRole("tab", { name: /1 of 1/ })).toHaveAttribute("aria-selected", "true");
  });

  it("puts Johnny first and approved reviews after that, newest first", async () => {
    render(<ReviewCarousel load={async () => [older, newer]} />);
    expect(await screen.findByText(newer.text)).toBeTruthy();
    const slides = document.querySelectorAll(".review-slide");
    expect(slides).toHaveLength(3);
    expect(slides[0].textContent).toContain("Johnny Tellez");
    expect(slides[1].textContent).toContain(newer.text);
    expect(slides[2].textContent).toContain(older.text);
    expect(slides[0].className).toContain("is-active");
  });

  it("does not auto-advance when the reader prefers reduced motion", async () => {
    const original = window.matchMedia;
    window.matchMedia = (query: string) => ({
      matches: query.includes("reduce"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
    vi.useFakeTimers();
    render(<ReviewCarousel load={async () => [newer]} />);
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector(".review-slide.is-active")?.textContent).toContain("Johnny Tellez");
    await act(async () => { vi.advanceTimersByTime(21000); });
    expect(document.querySelector(".review-slide.is-active")?.textContent).toContain("Johnny Tellez");
    window.matchMedia = original;
  });

  it("moves to the review a person chooses", async () => {
    render(<ReviewCarousel load={async () => [newer]} />);
    expect(await screen.findByText(newer.text)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /Newer Owner/ }));
    expect(document.querySelector(".review-slide.is-active")?.textContent).toContain(newer.text);
  });
});
