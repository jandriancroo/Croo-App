import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import logo from "/croo-logo-white.png";

const DEMO_PIN = "0223"; // Change before sharing widely
const STORAGE_KEY = "croohq_demo_unlocked";

const DemoGate = () => {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shaking, setShaking] = useState(false);

  // Auto-redirect if previously unlocked this session
  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY) === "yes") {
      window.location.replace("/demo-page.html");
    }
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === DEMO_PIN) {
      sessionStorage.setItem(STORAGE_KEY, "yes");
      window.location.href = "/demo-page.html";
    } else {
      setError(true);
      setShaking(true);
      setTimeout(() => setShaking(false), 500);
      setPin("");
    }
  };

  return (
    <>
      <Helmet>
        <title>CrooHQ Demo — Enter Access Code</title>
        <meta name="description" content="Private demo preview of CrooHQ. Enter your access code to continue." />
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>

      <main
        style={{
          minHeight: "100vh",
          background: "#0a0f14",
          color: "#fff",
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: "420px",
            background: "#0f1620",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: "20px",
            padding: "40px 32px",
            textAlign: "center",
            boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
            transform: shaking ? "translateX(0)" : undefined,
            animation: shaking ? "shake 0.4s" : undefined,
          }}
        >
          <img src={logo} alt="CrooHQ" style={{ height: "44px", marginBottom: "28px" }} />
          <h1 style={{ fontSize: "22px", fontWeight: 600, margin: "0 0 8px" }}>Demo Preview</h1>
          <p style={{ color: "rgba(255,255,255,0.55)", fontSize: "14px", margin: "0 0 28px" }}>
            Enter your access code to view the CrooHQ demo.
          </p>

          <form onSubmit={submit}>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => {
                setPin(e.target.value);
                setError(false);
              }}
              placeholder="••••"
              aria-label="Access code"
              style={{
                width: "100%",
                padding: "16px",
                fontSize: "20px",
                textAlign: "center",
                letterSpacing: "0.5em",
                background: "#0a0f14",
                border: `1px solid ${error ? "#ef4444" : "rgba(255,255,255,0.12)"}`,
                borderRadius: "12px",
                color: "#fff",
                outline: "none",
                marginBottom: "16px",
              }}
            />
            {error && (
              <p style={{ color: "#ef4444", fontSize: "13px", margin: "0 0 16px" }}>
                Incorrect code. Try again.
              </p>
            )}
            <button
              type="submit"
              style={{
                width: "100%",
                padding: "14px",
                fontSize: "15px",
                fontWeight: 600,
                background: "linear-gradient(135deg, #0a8f78, #15c4a0)",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                cursor: "pointer",
              }}
            >
              View Demo
            </button>
          </form>

          <p style={{ marginTop: "24px", fontSize: "12px", color: "rgba(255,255,255,0.35)" }}>
            Need access? Contact your CrooHQ representative.
          </p>
        </div>

        <style>{`
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-8px); }
            40%, 80% { transform: translateX(8px); }
          }
        `}</style>
      </main>
    </>
  );
};

export default DemoGate;
