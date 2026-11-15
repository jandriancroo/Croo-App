import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import BookDemo, { dayLabel, upcomingWeekdays } from "./BookDemo";

afterEach(() => cleanup());

const renderForm = () => render(
  <HelmetProvider>
    <MemoryRouter>
      <BookDemo />
    </MemoryRouter>
  </HelmetProvider>,
);

describe("CrooHQ demo request form", () => {
  it("offers the next ten weekdays, forty-eight hours out", () => {
    const wednesday = Date.parse("2026-11-11T15:00:00Z");
    const { days, earliest } = upcomingWeekdays(wednesday);
    expect(earliest.getTime() - wednesday).toBe(48 * 60 * 60 * 1000);
    expect(days).toHaveLength(10);
    expect(days.every(day => day.getDay() !== 0 && day.getDay() !== 6)).toBe(true);
    expect(dayLabel(days[0])).toEqual(expect.any(String));
  });

  it("requires a name, an email, and at least one time", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: "See CrooHQ in action" })).toBeTruthy();
    const name = screen.getByPlaceholderText("Jane Smith");
    const email = screen.getByPlaceholderText("you@company.com");
    expect(name).toBeRequired();
    expect(email).toHaveAttribute("type", "email");
    expect(email).toBeRequired();
    expect(screen.getByPlaceholderText("Smith Restaurant Group")).not.toBeRequired();
    expect(screen.getByPlaceholderText("e.g. Wingstop, Subway")).not.toBeRequired();
    expect(screen.getByPlaceholderText("(555) 123-4567")).toHaveAttribute("type", "tel");
    fireEvent.change(name, { target: { value: "Jordan Andrian" } });
    fireEvent.change(email, { target: { value: "jordan@croohq.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Request my demo" }));
    expect(screen.getByRole("alert").textContent).toBe("Please pick at least one time that works for you");
  });

  it("posts the same fields to the existing request-demo function", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    fireEvent.change(screen.getByPlaceholderText("Jane Smith"), { target: { value: "Ada Owner" } });
    fireEvent.change(screen.getByPlaceholderText("you@company.com"), { target: { value: "ada@example.com" } });
    const days = screen.getAllByRole("button").filter(button => button.className.includes("bd-day"));
    fireEvent.click(days[days.length - 1]);
    const openSlot = screen.getAllByRole("button").find(button => button.className.includes("bd-slot") && !button.hasAttribute("disabled"));
    expect(openSlot).toBeTruthy();
    fireEvent.click(openSlot!);
    fireEvent.click(screen.getByRole("button", { name: "Request my demo" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hqadffricxfsbggqdqak.supabase.co/functions/v1/request-demo");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ name: "Ada Owner", email: "ada@example.com", company: "", franchise: "", phone: "", notes: "" });
    expect(body.preferred_slots).toHaveLength(1);
    expect(body.timezone).toEqual(expect.any(String));
    expect(await screen.findByRole("heading", { name: "Request sent" })).toBeTruthy();
    expect(screen.getByText(/ada@example.com/)).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
