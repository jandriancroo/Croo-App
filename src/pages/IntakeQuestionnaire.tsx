import { useEffect, useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { Link, useParams } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// Private, unlinked pre-call questionnaire. No autosave and no browser
// storage of any kind: answers live only in React state until submitted.

const FIELD_NAMES = [
  "name", "role", "num_stores", "loc_blaze", "loc_daves", "loc_mikes", "loc_other", "split",
  "tool_punch", "tool_comms", "tool_hr", "tool_hiring", "tool_inv", "tool_tasks",
  "one_thing", "headache", "pilot", "other",
] as const;
type FieldName = (typeof FIELD_NAMES)[number];
type Answers = Record<FieldName, string>;

const EMPTY: Answers = FIELD_NAMES.reduce((acc, key) => ({ ...acc, [key]: "" }), {} as Answers);

const TOOLS: { name: FieldName; label: string; options: string[] }[] = [
  { name: "tool_punch", label: "Punch clock and scheduling", options: ["7shifts", "HotSchedules", "Fourth", "Homebase", "When I Work", "Deputy", "Sling", "Connecteam", "ADP", "Paychex", "Paycom", "Paylocity", "Gusto", "UKG", "Harri", "Crunchtime", "Restaurant365", "Push Operations", "Planday", "Schedulefly", "Paper / spreadsheet"] },
  { name: "tool_comms", label: "Communication and manager logbook", options: ["Group text", "WhatsApp", "GroupMe", "Slack", "Microsoft Teams", "Email", "7shifts", "HotSchedules", "Homebase", "Connecteam", "Jolt", "Zenput", "MeazureUp", "Crunchtime", "Restaurant365", "Sling", "Notion", "Trello", "Google Docs / Sheets", "Paper logbook"] },
  { name: "tool_hr", label: "Write-ups and employee reviews", options: ["Paper forms", "Google Docs", "ADP", "Paychex", "Paycom", "Paylocity", "UKG", "BambooHR", "Gusto", "Rippling", "Harri", "Workstream", "Connecteam", "Homebase", "Lattice", "15Five", "HiBob", "Namely", "TriNet", "Push Operations"] },
  { name: "tool_hiring", label: "Hiring", options: ["Indeed", "Workstream", "Harri", "Snagajob", "ZipRecruiter", "Homebase", "7shifts", "Craigslist", "Facebook", "LinkedIn", "Paycom", "Paylocity", "ADP", "BambooHR", "Fountain", "Breezy HR", "JazzHR", "Poached", "Culinary Agents", "Instawork", "Referrals / walk-ins"] },
  { name: "tool_inv", label: "Inventory", options: ["MarketMan", "Restaurant365", "Crunchtime", "BlueCart", "xtraCHEF", "Craftable", "meez", "Apicbase", "WISK", "Orderly", "Optimum Control", "BevSpot", "Partender", "Supy", "Galley", "Fourth", "Plate IQ", "ChefTec", "Spreadsheet", "Paper count sheets"] },
  { name: "tool_tasks", label: "Task management", options: ["Jolt", "Zenput", "Squadle", "MeazureUp", "Operandio", "Trail", "Connecteam", "ComplianceMate", "Crunchtime", "Restaurant365", "SafetyCulture", "Xenia", "FranConnect", "Homebase", "Monday.com", "Asana", "Trello", "Notion", "Google Sheets", "Paper checklists"] },
];

const CSS = `
.iq{min-height:100vh;background:#fbf8f3;color:#1a1a1a;font-family:Manrope,sans-serif;line-height:1.45}
.iq a{color:inherit;text-decoration:none}
.iq-wrap{width:min(760px,calc(100% - 40px));margin:0 auto}
.iq-hd{display:flex;align-items:center;padding:20px 0}
.iq-logo{height:32px}
.iq-main{padding:24px 0 64px}
.iq-card{overflow:hidden;border-radius:30px;background:#fff;box-shadow:0 2px 24px rgba(20,30,40,.08)}
.iq-band{background:#417f8e;color:#fff;padding:36px 32px}
.iq-kicker{margin:0 0 8px;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.85)}
.iq-band h1{margin:0;font-size:32px;line-height:1.15;font-weight:800;color:#fff}
.iq-band p.iq-sub{margin:10px 0 0;max-width:46ch;color:rgba(255,255,255,.9)}
.iq-form,.iq-done{padding:32px}
.iq-section{margin-bottom:28px}
.iq-section h2{margin:0 0 14px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#2e6270}
.iq-grid{display:grid;grid-template-columns:1fr;gap:16px}
.iq-grid.two{grid-template-columns:1fr 1fr}
.iq-field{display:flex;flex-direction:column;gap:6px;margin-bottom:16px}
.iq-field:last-child{margin-bottom:0}
.iq-grid .iq-field{margin-bottom:0}
.iq-label{font-size:14px;font-weight:700;color:#1a1a1a}
.iq-hint{font-weight:500;color:#5c5852;font-size:13px}
.iq-req{color:#417f8e}
.iq-brands{display:grid;gap:10px}
.iq-brandrow{display:grid;grid-template-columns:1fr 96px;gap:10px;align-items:center}
.iq-brandrow label{font-size:14px;font-weight:500}
.iq input,.iq textarea{width:100%;box-sizing:border-box;font:inherit;color:#1a1a1a;background:#fff;border:1px solid rgba(26,26,26,.16);border-radius:12px;padding:12px 14px}
.iq textarea{resize:vertical;min-height:88px}
.iq input:focus,.iq textarea:focus{outline:3px solid rgba(65,127,142,.25);border-color:#417f8e}
.iq-submit{margin-top:8px;width:100%;border:0;border-radius:12px;background:#417f8e;color:#fff;font:inherit;font-weight:800;font-size:16px;padding:14px 20px;cursor:pointer}
.iq-submit:disabled{opacity:.7;cursor:progress}
.iq-error{font-size:13px;color:#9f2d2d;font-weight:700;margin:12px 0 0;min-height:1em}
.iq-done{text-align:center;padding:56px 32px}
.iq-done h2{margin:0 0 8px;font-size:24px}
.iq-done p{margin:0 auto;max-width:42ch;color:#5c5852}
@media(max-width:760px){
  .iq-grid.two{grid-template-columns:1fr}
  .iq-band,.iq-form,.iq-done{padding:24px 18px}
  .iq-band h1{font-size:26px}
  .iq-logo{height:26px}
}
`;

type Status = "loading" | "notfound" | "form" | "done";

async function readError(error: unknown): Promise<{ status?: number; message: string }> {
  if (error instanceof FunctionsHttpError) {
    const status = error.context?.status as number | undefined;
    let message = "";
    try {
      const body = await error.context.json();
      message = typeof body?.error === "string" ? body.error : "";
    } catch { /* ignore */ }
    return { status, message };
  }
  return { message: "" };
}

export default function IntakeQuestionnaire() {
  const { slug = "" } = useParams();
  const [status, setStatus] = useState<Status>("loading");
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: fnError } = await supabase.functions.invoke("intake-questionnaire", {
        body: { action: "status", slug },
      });
      if (cancelled) return;
      if (fnError) {
        const { status: code } = await readError(fnError);
        if (cancelled) return;
        // Unknown link: no form. Any other failure falls through to the form;
        // the submit call reports its own error.
        setStatus(code === 404 ? "notfound" : "form");
        return;
      }
      setStatus(data?.submitted === true ? "done" : "form");
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const set = (key: FieldName) => (event: { target: { value: string } }) =>
    setAnswers(current => ({ ...current, [key]: event.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const trimmed = FIELD_NAMES.reduce((acc, key) => ({ ...acc, [key]: answers[key].trim() }), {} as Answers);
    if (!trimmed.name) {
      setError("Please add your name so we know who this is from.");
      document.getElementById("iq-name")?.focus();
      return;
    }
    setSending(true);
    const { error: fnError } = await supabase.functions.invoke("intake-questionnaire", {
      body: { action: "submit", slug, answers: trimmed },
    });
    if (!fnError) {
      setStatus("done");
      window.scrollTo(0, 0);
      return;
    }
    const { status: code, message } = await readError(fnError);
    if (code === 409) {
      setStatus("done");
      window.scrollTo(0, 0);
      return;
    }
    setError(`${message || "Something went wrong."} Please try again.`);
    setSending(false);
  };

  return (
    <div className="iq">
      <Helmet>
        <title>Questionnaire for DAMM Fine Pizza</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet" />
      </Helmet>
      <style>{CSS}</style>
      <div className="iq-wrap">
        <header className="iq-hd">
          <Link to="/"><img className="iq-logo" src="/croohq-wordmark.png" alt="CrooHQ" width={136} height={32} /></Link>
        </header>
        <main className="iq-main">
          {status === "loading" ? null : status === "notfound" ? (
            <div className="iq-card">
              <div className="iq-done">
                <h2>Page not found</h2>
              </div>
            </div>
          ) : (
            <div className="iq-card">
              <div className="iq-band">
                <p className="iq-kicker">CrooHQ</p>
                <h1>Questionnaire for DAMM Fine Pizza</h1>
                <p className="iq-sub">A few quick questions so we can make tomorrow's time count.</p>
              </div>
              {status === "done" ? (
                <div className="iq-done">
                  <h2>Thanks, we've got it.</h2>
                  <p>We'll use this to make tomorrow's time count. See you then.</p>
                </div>
              ) : (
                <form className="iq-form" onSubmit={submit} autoComplete="off" noValidate>
                  <div className="iq-section">
                    <h2>Who's filling this out</h2>
                    <div className="iq-grid two">
                      <div className="iq-field">
                        <label className="iq-label" htmlFor="iq-name">Name <span className="iq-req">*</span></label>
                        <input id="iq-name" name="name" type="text" maxLength={120} required value={answers.name} onChange={set("name")} />
                      </div>
                      <div className="iq-field">
                        <label className="iq-label" htmlFor="iq-role">Role</label>
                        <input id="iq-role" name="role" type="text" maxLength={120} value={answers.role} onChange={set("role")} />
                      </div>
                    </div>
                  </div>

                  <div className="iq-section">
                    <h2>Your Stores</h2>
                    <div className="iq-field">
                      <label className="iq-label" htmlFor="iq-num_stores">Number of stores</label>
                      <input id="iq-num_stores" name="num_stores" type="number" min={0} max={999} inputMode="numeric" value={answers.num_stores} onChange={set("num_stores")} />
                    </div>
                    <div className="iq-field">
                      <span className="iq-label">Number of locations per brand</span>
                      <div className="iq-brands">
                        <div className="iq-brandrow">
                          <label htmlFor="iq-loc_blaze">Blaze Pizza</label>
                          <input id="iq-loc_blaze" name="loc_blaze" type="number" min={0} max={999} inputMode="numeric" value={answers.loc_blaze} onChange={set("loc_blaze")} />
                        </div>
                        <div className="iq-brandrow">
                          <label htmlFor="iq-loc_daves">Dave's Hot Chicken</label>
                          <input id="iq-loc_daves" name="loc_daves" type="number" min={0} max={999} inputMode="numeric" value={answers.loc_daves} onChange={set("loc_daves")} />
                        </div>
                        <div className="iq-brandrow">
                          <label htmlFor="iq-loc_mikes">Mike's Red Tacos</label>
                          <input id="iq-loc_mikes" name="loc_mikes" type="number" min={0} max={999} inputMode="numeric" value={answers.loc_mikes} onChange={set("loc_mikes")} />
                        </div>
                        <div className="iq-field">
                          <label htmlFor="iq-loc_other" style={{ fontWeight: 500, fontSize: 14 }}>Other <span className="iq-hint">Brand and count, if any</span></label>
                          <input id="iq-loc_other" name="loc_other" type="text" maxLength={200} value={answers.loc_other} onChange={set("loc_other")} />
                        </div>
                      </div>
                    </div>
                    <div className="iq-field">
                      <label className="iq-label" htmlFor="iq-split">How are the stores split between team members?</label>
                      <textarea id="iq-split" name="split" maxLength={2000} value={answers.split} onChange={set("split")} />
                    </div>
                  </div>

                  <div className="iq-section">
                    <h2>What you use today</h2>
                    {TOOLS.map(tool => (
                      <div className="iq-field" key={tool.name}>
                        <label className="iq-label" htmlFor={`iq-${tool.name}`}>{tool.label}</label>
                        <input id={`iq-${tool.name}`} name={tool.name} type="text" maxLength={300} list={`${tool.name}_list`} value={answers[tool.name]} onChange={set(tool.name)} />
                        <datalist id={`${tool.name}_list`}>
                          {tool.options.map(option => <option key={option} value={option} />)}
                        </datalist>
                      </div>
                    ))}
                  </div>

                  <div className="iq-section">
                    <h2>Additional questions</h2>
                    <div className="iq-field">
                      <label className="iq-label" htmlFor="iq-one_thing">If you could see one thing every morning before calling stores, what would it be?</label>
                      <textarea id="iq-one_thing" name="one_thing" maxLength={2000} value={answers.one_thing} onChange={set("one_thing")} />
                    </div>
                    <div className="iq-field">
                      <label className="iq-label" htmlFor="iq-headache">Biggest headache right now</label>
                      <textarea id="iq-headache" name="headache" maxLength={2000} value={answers.headache} onChange={set("headache")} />
                    </div>
                  </div>

                  <div className="iq-section">
                    <h2>Getting started</h2>
                    <div className="iq-field">
                      <label className="iq-label" htmlFor="iq-pilot">3–5 stores you'd want to start with</label>
                      <textarea id="iq-pilot" name="pilot" maxLength={2000} value={answers.pilot} onChange={set("pilot")} />
                    </div>
                    <div className="iq-field">
                      <label className="iq-label" htmlFor="iq-other">Anything else we should know?</label>
                      <textarea id="iq-other" name="other" maxLength={3000} value={answers.other} onChange={set("other")} />
                    </div>
                  </div>

                  <button className="iq-submit" type="submit" disabled={sending}>{sending ? "Sending…" : "Send to CrooHQ"}</button>
                  <p className="iq-error" role="alert">{error}</p>
                </form>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
