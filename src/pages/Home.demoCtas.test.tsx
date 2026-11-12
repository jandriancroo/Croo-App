import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import Home from "./Home";

vi.mock("@/components/home/HomeDemos", () => ({ default: () => null }));

const DEMO_REQUEST = "/demo";

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
      "Book a 20-minute walkthrough",
    ]);
    for (const link of walkthroughs) expect(link).toHaveAttribute("href", DEMO_REQUEST);
    const pricing = screen.getAllByRole("link", { name: "Get Pricing" });
    expect(pricing).toHaveLength(2);
    for (const link of pricing) expect(link).toHaveAttribute("href", DEMO_REQUEST);
    expect(screen.queryByText(/\$199/)).toBeNull();
    expect(screen.queryByText(/14 days/i)).toBeNull();
    expect(screen.queryByText(/Toast|Clover|Aloha/)).toBeNull();
  });

  it("keeps the footer contact email and adds Contact Us", async () => {
    await renderHome();
    expect(screen.getByRole("link", { name: "Contact: jordan@croohq.com" })).toHaveAttribute("href", "mailto:jordan@croohq.com");
    expect(screen.getByRole("link", { name: "Contact Us" })).toHaveAttribute("href", "mailto:jordan@croohq.com");
    expect(screen.queryAllByRole("link", { name: /walkthrough/i }).every(link => link.getAttribute("href") !== "mailto:jordan@croohq.com")).toBe(true);
  });

  it("keeps wide screens from stretching the hero and support band", async () => {
    await renderHome();
    const css = Array.from(document.querySelectorAll("style")).map(node => node.textContent || "").join("\n");
    expect(css).toContain("@media(min-width:1481px)");
    expect(css).toContain(".hme .hero,.hme .how{width:1440px;margin-left:auto;margin-right:auto}");
  });

  it("uses restaurant photos in the hero and keeps the product sequence", async () => {
    const { container } = await renderHome();
    const hero = container.querySelector(".hero");
    const photos = hero?.querySelectorAll(".hero-bg img");
    expect(photos).toHaveLength(3);
    expect(photos?.[0]).toHaveAttribute("src", "/hero/kitchen-line.webp");
    expect(photos?.[0]).toHaveAttribute("alt", "");
    expect(photos?.[0]).toHaveAttribute("loading", "eager");
    expect(photos?.[1]).toHaveAttribute("src", "/hero/manager-opening.webp");
    expect(photos?.[1]).toHaveAttribute("loading", "lazy");
    expect(photos?.[2]).toHaveAttribute("alt", "");
    expect(hero?.querySelector(".stage")).toBeNull();
    expect(hero?.textContent).not.toContain("Morning Line Check");
    expect(container.querySelectorAll(".pm-step")).toHaveLength(3);
    expect(Array.from(container.querySelectorAll(".pm-label")).map(node => node.textContent)).toEqual(["Checklists", "Punch clock", "Scheduling"]);
  });

  it("counts cash by denomination and opens a store rollup", async () => {
    const { default: HomeDemos } = await vi.importActual<typeof import("@/components/home/HomeDemos")>("@/components/home/HomeDemos");
    render(<HomeDemos />);
    fireEvent.click(screen.getByRole("tab", { name: "Cash logs" }));
    expect(screen.getByText("Short $12.00")).toBeTruthy();
    expect(screen.getByText("Expected bank")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Add one \$1$/ }));
    expect(screen.getByText("Short $11.00")).toBeTruthy();
    expect(screen.getByText("$189.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Multi-location visibility" }));
    fireEvent.click(screen.getByRole("button", { name: "Open checklists" }));
    expect(screen.queryByRole("button", { name: /Oak Plaza/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Westfield/ }));
    expect(screen.getByText("Not Started")).toBeTruthy();
    expect(screen.getByText("Labor 31.2% · budget 26%")).toBeTruthy();
  });

  it("keeps the interactive product preview anchor", async () => {
    const { default: HomeDemos } = await vi.importActual<typeof import("@/components/home/HomeDemos")>("@/components/home/HomeDemos");
    const { container } = render(<HomeDemos />);
    expect(container.querySelector("#see-it")).toBeTruthy();
    expect(container.querySelectorAll(`a[href="${DEMO_REQUEST}"]`)).toHaveLength(0);
    expect(container.querySelectorAll('a[href*="#see-it"]')).toHaveLength(0);
  });
});
