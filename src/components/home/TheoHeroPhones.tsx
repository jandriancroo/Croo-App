import { SALES_ASK, SALES_REPLY, SHIFT_ASK, SHIFT_REPLY } from "./theoHeroMotion";

function TheoChat({ ask, reply }: { ask: string; reply: string }) {
  return (
    <div className="theo-chat">
      <div className="theo-head">
        <span className="theo-orb" aria-hidden="true" />
        <span className="theo-id">
          <strong>Theo</strong>
          <span className="theo-status"><i />AI Assistant</span>
        </span>
      </div>
      <div className="theo-thread">
        <p className="theo-user theo-anim">{ask}</p>
        <div className="theo-dots theo-anim" aria-hidden="true"><b /><b /><b /></div>
        <div className="theo-reply theo-anim">
          <div className="theo-who"><span className="theo-orb" aria-hidden="true" />Theo</div>
          <p className="theo-card">{reply}</p>
        </div>
      </div>
      <div className="theo-compose" aria-hidden="true">
        <div className="theo-field">Ask Theo anything...</div>
        <div className="theo-send" />
      </div>
    </div>
  );
}

function Phone({ kind, ask, reply }: { kind: "shift" | "sales"; ask: string; reply: string }) {
  const label = kind === "shift" ? "Sample interaction, shift coverage" : "Sample interaction, end of night sales";
  return (
    <div className={`theo-phone theo-phone-${kind} theo-anim`} role="group" aria-label={label}>
      <div className="pm-device pm-phone">
        <div className="pm-hardware">
          <span className="pm-island" aria-hidden="true" />
          <TheoChat ask={ask} reply={reply} />
        </div>
      </div>
      <p className="theo-tag">Sample interaction</p>
    </div>
  );
}

/** Static marketing phones. Copy is the two Theo jobs that ship today. */
export default function TheoHeroPhones() {
  return (
    <div className="theo-phones theo-anim">
      <Phone kind="shift" ask={SHIFT_ASK} reply={SHIFT_REPLY} />
      <Phone kind="sales" ask={SALES_ASK} reply={SALES_REPLY} />
    </div>
  );
}
