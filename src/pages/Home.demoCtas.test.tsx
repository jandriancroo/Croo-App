import { act, cleanup, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Home from "./Home";

vi.mock("@/components/home/HomeDemos", () => ({ default: () => null }));

const DEMO_REQUEST = "https://supaclose.lovable.app/demo";

beforeAll(() => {
  class Observer {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("IntersectionObserver", Observer);
});

afterEach(() => cleanup());

const renderHome = async () => {
  const view = render(
    <HelmetProvider>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </HelmetProvider>,
  );
  await act(async () => { await Promise.resolve(); });
  return view;
};

describe("homepage demo request links", () => {
  it("sends walkthrough buttons to the existing request form", async () => {
    await renderHome();
    const walkthroughs = screen.getAllByRole("link", { name: /walkthrough/i });
    expect(walkthroughs.map(link => link.textContent)).toEqual([
      "Book a walkthrough",
      "Book a 20-minute walkthrough",
      "Book a walkthrough",
      "Book a 20-minute walkthrough",
    ]);
    for (const link of walkthroughs) expect(link).toHaveAttribute("href", DEMO_REQUEST);
  });

  it("keeps the footer contact email and the in-page price jump", async () => {
    await renderHome();
    expect(screen.getByRole("link", { name: "Contact: jordan@croohq.com" })).toHaveAttribute("href", "mailto:jordan@croohq.com");
    expect(screen.getByRole("link", { name: "Starting at $199/month" })).toHaveAttribute("href", "#stack");
    expect(screen.queryAllByRole("link", { name: /walkthrough/i }).every(link => link.getAttribute("href") !== "mailto:jordan@croohq.com")).toBe(true);
  });

  it("keeps the interactive product preview anchor", async () => {
    const { default: HomeDemos } = await vi.importActual<typeof import("@/components/home/HomeDemos")>("@/components/home/HomeDemos");
    const { container } = render(<HomeDemos />);
    expect(container.querySelector("#see-it")).toBeTruthy();
    expect(container.querySelectorAll(`a[href="${DEMO_REQUEST}"]`)).toHaveLength(0);
    expect(container.querySelectorAll('a[href*="#see-it"]')).toHaveLength(0);
  });
});
