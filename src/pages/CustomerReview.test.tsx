import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomerReview from "./CustomerReview";
import { draftReview, submitReview } from "@/lib/customerReviewsApi";
import { CONSENT } from "@/lib/customerReviewFlow";

vi.mock("@/lib/customerReviewsApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/customerReviewsApi")>("@/lib/customerReviewsApi");
  return { ...actual, draftReview: vi.fn(), submitReview: vi.fn() };
});

const DRAFT = "The schedule lived in a group text. CrooHQ keeps Saturday on one list. I would tell another operator to start with the schedule.";

beforeEach(() => {
  localStorage.clear();
  vi.mocked(draftReview).mockReset();
  vi.mocked(submitReview).mockReset();
  vi.mocked(draftReview).mockResolvedValue({ text: DRAFT, drafted: true });
  vi.mocked(submitReview).mockResolvedValue();
});

afterEach(() => cleanup());

function renderPage() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <CustomerReview />
      </MemoryRouter>
    </HelmetProvider>,
  );
}

function fillWho(locations: "1" | "2-5" | "6+") {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Ada Owner" } });
  fireEvent.click(screen.getByRole("button", { name: "Owner" }));
  fireEvent.change(screen.getByLabelText("Your restaurant"), { target: { value: "Pine Street Pizza" } });
  fireEvent.click(screen.getByRole("button", { name: locations }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

function answer(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("customer review builder", () => {
  it("walks one store through the approved questions and saves consent", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /Got 3 minutes/ })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Share a CrooHQ review"));
    expect(document.head.querySelector("meta[name=robots]")?.getAttribute("content")).toContain("noindex");
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("alert").textContent).toMatch(/name/i);

    fillWho("1");
    expect(screen.getByRole("heading", { name: "What was the biggest headache in running your store before CrooHQ?" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /multiple locations/i })).toBeNull();
    answer("The schedule lived in a group text.");

    expect(screen.getByRole("heading", { name: /feature would you miss most/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Scheduling" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("heading", { name: "How has CrooHQ helped?" })).toBeTruthy();
    expect(screen.queryByText(/time, money or stress/i)).toBeNull();
    answer("Crew HQ keeps Saturday on one list.");

    expect(screen.getByRole("heading", { name: "What do you ask Theo?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    answer("I would tell another operator to start with the schedule.");
    fireEvent.click(screen.getByRole("button", { name: "Write my review" }));
    expect(await screen.findByRole("heading", { name: "Does this sound like you?" })).toBeTruthy();
    expect(screen.getByLabelText("Your review")).toHaveValue(DRAFT);
    expect(screen.getByText("Ada Owner, Owner, Pine Street Pizza")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByRole("alert").textContent).toMatch(/permission/i);
    fireEvent.click(screen.getByRole("checkbox", { name: CONSENT }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(await screen.findByRole("heading", { name: "Thanks! We'll review it before it goes up." })).toBeTruthy();
    expect(submitReview).toHaveBeenCalledTimes(1);
    const row = vi.mocked(submitReview).mock.calls[0][0];
    expect(row).toMatchObject({
      name: "Ada Owner",
      role: "Owner",
      restaurant: "Pine Street Pizza",
      anonymous: false,
      consent: true,
      final_text: DRAFT,
    });
    expect(row.raw_answers.locationCount).toBe("1");
    expect(row.raw_answers.multiLocationSurprise).toBe("");
    expect(JSON.stringify(row)).not.toMatch(/password|card number|payment/i);
  });

  it("shows a writing card until the draft comes back", async () => {
    let resolveDraft: (value: { text: string; drafted: boolean }) => void = () => {};
    vi.mocked(draftReview).mockImplementation(() => new Promise(resolve => { resolveDraft = resolve; }));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fillWho("1");
    answer("The close.");
    fireEvent.click(screen.getByRole("button", { name: "Checklists" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    answer("The list is in one place.");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    answer("Try it on a Tuesday.");
    fireEvent.click(screen.getByRole("button", { name: "Write my review" }));
    expect(await screen.findByRole("heading", { name: "Writing your review" })).toBeTruthy();
    await act(async () => { resolveDraft({ text: DRAFT, drafted: true }); });
    expect(await screen.findByRole("heading", { name: "Does this sound like you?" })).toBeTruthy();
  });

  it("asks about multiple locations only when they run two or more", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fillWho("6+");
    answer("Coverage.");
    expect(screen.getByRole("heading", { name: "What surprised you most about owning multiple locations?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("alert").textContent).toMatch(/surprised/i);
  });

  it("lets them write the review when drafting fails", async () => {
    vi.mocked(draftReview).mockResolvedValue({ text: "", drafted: false });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fillWho("1");
    answer("The close.");
    fireEvent.click(screen.getByRole("button", { name: "Scheduling" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    answer("It made the close calmer.");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    answer("Start with one store.");
    fireEvent.click(screen.getByRole("button", { name: "Write my review" }));
    expect(await screen.findByRole("heading", { name: "Does this sound like you?" })).toBeTruthy();
    expect(screen.getByText(/write the review yourself/i)).toBeTruthy();
    const box = screen.getByLabelText("Your review");
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: "I write this myself, and CrooHQ can use these words." } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("heading", { name: "Approve your words" })).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /Keep me anonymous/ }));
    expect(screen.getByLabelText("Restaurant type")).toBeTruthy();
    expect(screen.getByLabelText("State")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Restaurant type"), { target: { value: "fast-casual pizza" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "CA" } });
    expect(screen.getByText("Owner, fast-casual pizza, CA")).toBeTruthy();
  });

  it("does not save a submission that trips the honeypot", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fillWho("1");
    answer("The close.");
    fireEvent.click(screen.getByRole("button", { name: "Scheduling" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    answer("It made the close calmer.");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    answer("Start with one store.");
    fireEvent.click(screen.getByRole("button", { name: "Write my review" }));
    expect(await screen.findByLabelText("Your review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    const trap = document.querySelector<HTMLInputElement>("input[name=company_website]");
    expect(trap).toBeTruthy();
    fireEvent.change(trap!, { target: { value: "https://spam.example" } });
    fireEvent.click(screen.getByRole("checkbox", { name: CONSENT }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("heading", { name: "Thanks! We'll review it before it goes up." })).toBeTruthy();
    expect(submitReview).not.toHaveBeenCalled();
  });
});
