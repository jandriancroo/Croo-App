import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { SiteFooter } from "@/components/marketing/SiteFooter";
import { scrubPublicText, stitchFallback } from "../../supabase/functions/write-customer-review/combine.ts";
import { draftReview, nextReviewQuestionSet, reviewRow, submitReview } from "@/lib/customerReviewsApi";
import {
  ADVICE,
  ANONYMOUS,
  ANYTHING_ELSE,
  CONSENT,
  EMPTY_REVIEW_FORM,
  FEATURE,
  FEATURES,
  HEADACHE,
  HELPED,
  INTRO,
  LOCATION_CHOICES,
  MULTI,
  RECOMMEND_TO,
  ROLES,
  SAVED_MOMENT,
  SHIFT_BEFORE_AFTER,
  TEAM_NOTICED,
  THEO,
  attributionLine,
  interviewSteps,
  rememberReviewSubmit,
  reviewRateLimited,
  stepError,
  toReviewAnswers,
  type ReviewForm,
  type StepId,
} from "@/lib/customerReviewFlow";

const CSS = `
.rv{min-height:100vh;background:#fbf8f3;color:#1a1a1a;font-family:Manrope,sans-serif;font-weight:500;line-height:1.45;-webkit-font-smoothing:antialiased}
.rv *{box-sizing:border-box}
.rv a{color:inherit;text-decoration:none}
.rv-wrap{width:min(720px,calc(100% - 32px));margin:0 auto}
.rv-hd{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 0}
.rv-logo{height:32px}
.rv-nav{display:flex;gap:18px;align-items:center;font-size:14px;font-weight:700;color:#5c5852}
.rv-login{background:#eb7d3c;color:#fff;border-radius:999px;padding:12px 18px}
.rv-main{padding:8px 0 48px}
.rv-count{margin:0 0 10px;color:#417f8e;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
.rv-dots{display:flex;gap:6px;margin:0 0 14px}
.rv-dots span{width:8px;height:8px;border-radius:99px;background:rgba(26,26,26,.16)}
.rv-dots span.is-on{width:22px;background:#417f8e}
.rv-card{background:#fffcf7;border:1px solid rgba(26,26,26,.08);border-radius:28px;padding:28px 22px 22px;box-shadow:0 18px 44px rgba(26,26,26,.06);animation:rv-in .35s cubic-bezier(.2,.7,.2,1)}
.rv-card.is-back{animation-name:rv-in-back}
@keyframes rv-in{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes rv-in-back{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
.rv h1{margin:0;font-family:Fraunces,Georgia,serif;font-weight:500;font-size:30px;line-height:1.2;letter-spacing:0}
.rv-help{margin:12px 0 0;color:#5c5852;font-size:16px;font-weight:600;letter-spacing:0;text-transform:none}
.rv-label{margin:0;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#5c5852}
.rv-fields{display:flex;flex-direction:column;gap:16px;margin-top:22px}
.rv label{display:flex;flex-direction:column;gap:8px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#5c5852}
.rv input,.rv textarea{font:inherit;font-size:16px;font-weight:600;letter-spacing:0;text-transform:none;color:#1a1a1a;background:#fff;border:1.5px solid rgba(26,26,26,.16);border-radius:14px;padding:14px 16px;min-height:52px;width:100%}
.rv textarea{min-height:180px;resize:vertical;line-height:1.45}
.rv-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.rv-chip{min-height:48px;padding:12px 16px;border-radius:999px;border:1.5px solid rgba(26,26,26,.14);background:#fff;color:#1a1a1a;font:inherit;font-size:15px;font-weight:700;cursor:pointer}
.rv-chip[aria-pressed="true"]{background:#417f8e;border-color:#417f8e;color:#fff}
.rv-actions{display:flex;gap:10px;margin-top:22px}
.rv-back,.rv-next{min-height:52px;border-radius:999px;font:inherit;font-size:16px;font-weight:800;cursor:pointer}
.rv-back{padding:12px 18px;background:transparent;border:1.5px solid rgba(26,26,26,.16);color:#1a1a1a}
.rv-next{flex:1;border:0;background:#417f8e;color:#fff}
.rv-next:disabled,.rv-back:disabled{opacity:.65;cursor:progress}
.rv-error{margin:14px 0 0;color:#9f2d2d;font-weight:700}
.rv-note{margin:14px 0 0;color:#2e6270;font-weight:700}
.rv-by{margin-top:16px;color:#5c5852;font-size:14px;font-weight:700}
.rv-quote{margin:18px 0 0;font-family:Fraunces,Georgia,serif;font-style:italic;font-size:22px;line-height:1.35}
.rv label.rv-check{flex-direction:row;align-items:flex-start;gap:12px;text-transform:none;letter-spacing:0;font-size:15px;font-weight:600;color:#1a1a1a;line-height:1.4}
.rv-check input{width:22px;height:22px;min-height:22px;margin-top:2px;flex:none;accent-color:#417f8e}
.rv-trap{position:absolute;left:-10000px;top:auto;width:1px;height:1px;overflow:hidden}
.rv-foot{padding:8px 0 28px}
.rv button:focus-visible,.rv a:focus-visible,.rv input:focus-visible,.rv textarea:focus-visible{outline:3px solid #eb7d3c;outline-offset:3px}
.rv h1:focus{outline:none}
.rv-foot nav{display:flex;flex-wrap:wrap;gap:14px 18px}
@media(min-width:761px){.rv h1{font-size:40px}.rv-card{padding:36px 32px 28px}}
@media(max-width:760px){.rv-nav a:not(.rv-login){display:none}.rv-logo{height:26px}}
@media(prefers-reduced-motion:reduce){.rv-card{animation:none}}
`;

function Chip({ pressed, children, onClick }: { pressed: boolean; children: string; onClick: () => void }) {
  return <button type="button" className="rv-chip" aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

export default function CustomerReview() {
  const [form, setForm] = useState<ReviewForm>(EMPTY_REVIEW_FORM);
  const [step, setStep] = useState<StepId>("intro");
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [error, setError] = useState("");
  const [draftNote, setDraftNote] = useState("");
  const [sending, setSending] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [trap, setTrap] = useState("");
  const formRef = useRef(form);
  const trapRef = useRef("");
  formRef.current = form;
  trapRef.current = trap;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const steps = interviewSteps(form.locationCount, form.questionSet);
  const interviewIndex = steps.indexOf(step);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    let cancel = false;
    nextReviewQuestionSet().then(questionSet => {
      if (!cancel) setForm(current => current.questionSet === questionSet ? current : { ...current, questionSet });
    });
    return () => { cancel = true; };
  }, []);

  useEffect(() => {
    if (step !== "writing") return;
    let cancel = false;
    draftReview(toReviewAnswers(formRef.current), undefined, trapRef.current).then(result => {
      if (cancel) return;
      setForm(current => ({ ...current, finalText: result.text }));
      setDraftNote(result.drafted ? "" : "We couldn't draft this one. Your answers are below. Edit them, or write the review yourself.");
      setDir("forward");
      setStep("edit");
    });
    return () => { cancel = true; };
  }, [step]);

  const patch = (partial: Partial<ReviewForm>) => {
    setForm(current => ({ ...current, ...partial }));
    setError("");
  };

  const go = (next: StepId, direction: "forward" | "back") => {
    setDir(direction);
    setError("");
    setStep(next);
  };

  const goNext = () => {
    const problem = stepError(step, form);
    if (problem) {
      setError(problem);
      return;
    }
    if (step === "edit") {
      const text = scrubPublicText(form.finalText);
      if (!text) {
        setError("Write the review in your own words.");
        return;
      }
      patch({ finalText: text });
      go("approve", "forward");
      return;
    }
    const index = steps.indexOf(step);
    go(index >= 0 && steps[index + 1] ? steps[index + 1] : "writing", "forward");
  };

  const goBack = () => {
    if (step === "approve") {
      go("edit", "back");
      return;
    }
    if (step === "edit") {
      go("else", "back");
      return;
    }
    const index = steps.indexOf(step);
    if (index > 0) go(steps[index - 1], "back");
  };

  const rewrite = async () => {
    setRewriting(true);
    setError("");
    const result = await draftReview(toReviewAnswers(form), undefined, trapRef.current);
    setRewriting(false);
    if (!result.text) {
      setError("We couldn't rewrite it just now. You can edit the words yourself.");
      return;
    }
    patch({ finalText: result.text });
    setDraftNote(result.drafted ? "" : "We couldn't draft a new version. Your earlier words are still here to edit.");
  };

  const approve = async () => {
    const problem = stepError("approve", form);
    if (problem) {
      setError(problem);
      return;
    }
    if (trap.trim()) {
      go("thanks", "forward");
      return;
    }
    if (reviewRateLimited()) {
      setError("Please wait a bit, then try again.");
      return;
    }
    setSending(true);
    try {
      await submitReview(reviewRow(form));
      rememberReviewSubmit();
      go("thanks", "forward");
    } catch {
      setError("We couldn't save that. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const enterNext = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goNext();
    }
  };

  let body: ReactNode = null;
  let nextLabel = "Next";
  let onNext: (() => void) | null = goNext;
  if (step === "intro") {
    nextLabel = "Start";
    body = null;
  } else if (step === "who") {
    body = (
      <div className="rv-fields">
        <label>Your name
          <input value={form.name} onChange={event => patch({ name: event.target.value })} onKeyDown={enterNext} autoComplete="name" />
        </label>
        <div>
          <p className="rv-label" id="rv-role">Your role</p>
          <div className="rv-chips" role="group" aria-labelledby="rv-role">
            {ROLES.map(role => <Chip key={role} pressed={form.role === role} onClick={() => patch({ role })}>{role}</Chip>)}
          </div>
        </div>
        {form.role === "Other" && (
          <label>Role, if it's not listed
            <input value={form.roleOther} onChange={event => patch({ roleOther: event.target.value })} onKeyDown={enterNext} />
          </label>
        )}
        <label>Your restaurant
          <input value={form.restaurant} onChange={event => patch({ restaurant: event.target.value })} onKeyDown={enterNext} autoComplete="organization" />
        </label>
        <div>
          <p className="rv-label" id="rv-locations">How many locations do you run?</p>
          <div className="rv-chips" role="group" aria-labelledby="rv-locations">
            {LOCATION_CHOICES.map(choice => (
              <Chip key={choice} pressed={form.locationCount === choice} onClick={() => patch({ locationCount: choice, multi: choice === "1" ? "" : form.multi })}>{choice}</Chip>
            ))}
          </div>
        </div>
      </div>
    );
  } else if (step === "headache" || step === "multi" || step === "helped" || step === "theo" || step === "advice" || step === "else" || step === "shift" || step === "moment" || step === "team" || step === "recommend") {
    const field = step === "headache" ? "headache"
      : step === "multi" ? "multi"
      : step === "helped" ? "helped"
      : step === "theo" ? "theo"
      : step === "advice" ? "advice"
      : step === "shift" ? "shift"
      : step === "moment" ? "moment"
      : step === "team" ? "team"
      : step === "recommend" ? "recommend"
      : "elseNote";
    body = (
      <div className="rv-fields">
        {(step === "theo" || step === "else") && <p className="rv-help">Optional.</p>}
        {step === "theo" && <p className="rv-help">Theo is CrooHQ's AI manager assistant. Skip this if you haven't talked to Theo.</p>}
        <textarea aria-label="Your answer" value={form[field]} onChange={event => patch({ [field]: event.target.value })} />
      </div>
    );
  } else if (step === "feature") {
    body = (
      <div className="rv-fields">
        <div className="rv-chips" role="group" aria-label="Features">
          {FEATURES.map(feature => <Chip key={feature} pressed={form.feature === feature} onClick={() => patch({ feature: form.feature === feature ? "" : feature })}>{feature}</Chip>)}
        </div>
        <label>Or say it in your own words
          <textarea value={form.featureNote} onChange={event => patch({ featureNote: event.target.value })} />
        </label>
      </div>
    );
  } else if (step === "writing") {
    nextLabel = "I'll write it";
    onNext = () => {
      const stitched = form.finalText.trim() ? form.finalText : stitchFallback(toReviewAnswers(form));
      setDraftNote("Write it in your own words. You can use your answers as a start.");
      patch({ finalText: stitched });
      go("edit", "forward");
    };
    body = <p className="rv-help">Pulling your answers into a short paragraph. You can change every word.</p>;
  } else if (step === "edit") {
    nextLabel = "Continue";
    body = (
      <div className="rv-fields">
        {draftNote && <p className="rv-note">{draftNote}</p>}
        <label>Your review
          <textarea value={form.finalText} onChange={event => patch({ finalText: event.target.value })} />
        </label>
        <button type="button" className="rv-back" onClick={rewrite} disabled={rewriting}>{rewriting ? "Rewriting…" : "Rewrite it"}</button>
        <p className="rv-by">{attributionLine({ ...form, anonymous: false })}</p>
      </div>
    );
  } else if (step === "approve") {
    nextLabel = sending ? "Saving…" : "Approve";
    onNext = approve;
    body = (
      <div className="rv-fields">
        <p className="rv-quote">{form.finalText}</p>
        <p className="rv-by">{attributionLine(form)}</p>
        <label className="rv-check">
          <input type="checkbox" checked={form.consent} onChange={event => patch({ consent: event.target.checked })} />
          <span>{CONSENT}</span>
        </label>
        <label className="rv-check">
          <input type="checkbox" checked={form.anonymous} onChange={event => patch({ anonymous: event.target.checked })} />
          <span>{ANONYMOUS}</span>
        </label>
        {form.anonymous && (
          <>
            <label>Restaurant type
              <input value={form.restaurantType} placeholder="fast-casual pizza" onChange={event => patch({ restaurantType: event.target.value })} onKeyDown={enterNext} />
            </label>
            <label>State
              <input value={form.state} placeholder="CA" onChange={event => patch({ state: event.target.value })} onKeyDown={enterNext} />
            </label>
          </>
        )}
      </div>
    );
  } else {
    onNext = null;
    body = (
      <>
        <div className="rv-actions"><Link className="rv-next" to="/" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>Back to CrooHQ</Link></div>
      </>
    );
  }

  const title = step === "intro" ? INTRO
    : step === "who" ? "Your name, your role, and your restaurant."
    : step === "headache" ? HEADACHE
    : step === "multi" ? MULTI
    : step === "feature" ? FEATURE
    : step === "helped" ? HELPED
    : step === "theo" ? THEO
    : step === "advice" ? ADVICE
    : step === "shift" ? SHIFT_BEFORE_AFTER
    : step === "moment" ? SAVED_MOMENT
    : step === "team" ? TEAM_NOTICED
    : step === "recommend" ? RECOMMEND_TO
    : step === "else" ? ANYTHING_ELSE
    : step === "writing" ? "Writing your review"
    : step === "edit" ? "Does this sound like you?"
    : step === "approve" ? "Approve your words"
    : "Thanks! We'll review it before it goes up.";

  if (step === "else") nextLabel = "Write my review";

  return (
    <div className="rv">
      <Helmet>
        <title>Share a CrooHQ review</title>
        <meta name="robots" content="noindex, nofollow, noarchive" />
        <meta name="googlebot" content="noindex, nofollow" />
        <meta name="description" content="Tell CrooHQ how the product is working in your store. You approve every word before it is used." />
        <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;1,9..144,500&family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet" />
      </Helmet>
      <style>{CSS}</style>
      <div className="rv-wrap">
        <header className="rv-hd">
          <Link to="/"><img className="rv-logo" src="/croohq-wordmark.png" alt="CrooHQ" width={136} height={32} /></Link>
          <nav className="rv-nav" aria-label="Main navigation">
            <a href="/blog/">Blog</a>
            <Link to="/jobs">Jobs</Link>
            <Link className="rv-login" to="/auth">App Login</Link>
          </nav>
        </header>
        <main className="rv-main">
          <p className="rv-count">{interviewIndex >= 0 ? `Step ${interviewIndex + 1} of ${steps.length}` : "Review"}</p>
          {interviewIndex >= 0 && (
            <div className="rv-dots" aria-hidden="true">
              {steps.map(id => <span key={id} className={id === step ? "is-on" : ""} />)}
            </div>
          )}
          <div className={dir === "back" ? "rv-card is-back" : "rv-card"} data-question-set={form.questionSet}>
            <h1 id="rv-heading" tabIndex={-1} ref={headingRef}>{title}</h1>
            {body}
            {error && <p className="rv-error" role="alert">{error}</p>}
            {onNext && (
              <div className="rv-actions">
                {step !== "intro" && step !== "writing" && <button type="button" className="rv-back" onClick={goBack}>Back</button>}
                <button type="button" className="rv-next" onClick={onNext} disabled={sending || rewriting}>{nextLabel}</button>
              </div>
            )}
          </div>
          <div className="rv-trap" aria-hidden="true">
            <label>Website
              <input name="company_website" tabIndex={-1} autoComplete="off" value={trap} onChange={event => setTrap(event.target.value)} />
            </label>
          </div>
        </main>
        <div className="rv-foot">
          <SiteFooter>
            <nav aria-label="Footer navigation">
              <Link to="/">Home</Link>
              <a href="/blog/">Blog</a>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms</Link>
            </nav>
          </SiteFooter>
        </div>
      </div>
    </div>
  );
}
