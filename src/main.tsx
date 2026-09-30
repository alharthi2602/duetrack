import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Check } from "lucide-react";
import { cloud, configured } from "./auth/client";
import { Dashboard } from "./components/Dashboard";
import "./styles.css";
function App() {
  const [owner, setOwner] = useState(""),
    [email, setEmail] = useState(""),
    [authMode, setAuthMode] = useState("signin"),
    [message, setMessage] = useState("");
  useEffect(() => {
    cloud?.auth
      .getSession()
      .then(({ data }) => setOwner(data.session?.user.id || ""));
    const subscription = cloud?.auth.onAuthStateChange((event, s) => {
      setOwner(s?.user.id || "");
      if (event === "PASSWORD_RECOVERY") setAuthMode("password");
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, []);
  if (owner && authMode !== "password")
    return <Dashboard key={owner} owner={owner} leave={() => setOwner("")} />;
  return (
    <div className="auth-page">
      <div className="brand">
        <span className="brand-icon">
          <Check />
        </span>
        DueTrack
      </div>
      <section className="auth-card">
        <span className="eyebrow">A little clarity, every month</span>
        <h1>
          Your payments.
          <br />
          All in order.
        </h1>
        <p className="muted">
          Keep track of what’s due, what’s paid, and the receipts that go with
          it.
        </p>
        {!configured ? (
          <>
            <div className="notice">
              Cloud account setup is pending. The preview saves on this device
              only.
            </div>
            <button className="primary wide" onClick={() => setOwner("demo")}>
              Explore the local preview
            </button>
            <p className="muted">
              To enable accounts and synchronization, follow the backend setup
              in the project README.
            </p>
          </>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setMessage("");
              const f = new FormData(e.currentTarget),
                password = String(f.get("password"));
              try {
                if (authMode === "password") {
                  const { error } = await cloud!.auth.updateUser({ password });
                  if (error) throw error;
                  setAuthMode("signin");
                  setMessage("Password updated");
                } else if (authMode === "reset") {
                  const { error } = await cloud!.auth.resetPasswordForEmail(
                    email,
                    { redirectTo: location.origin },
                  );
                  if (error) throw error;
                  setMessage(
                    "If an account exists, check your email for a recovery link.",
                  );
                } else {
                  const { error } =
                    authMode === "register"
                      ? await cloud!.auth.signUp({ email, password })
                      : await cloud!.auth.signInWithPassword({
                          email,
                          password,
                        });
                  if (error) throw error;
                  if (authMode === "register")
                    setMessage("Check your email to confirm your account.");
                }
              } catch (e) {
                setMessage((e as Error).message);
              }
            }}
          >
            <h2>
              {authMode === "register"
                ? "Create an account"
                : authMode === "reset"
                  ? "Reset your password"
                  : authMode === "password"
                    ? "Choose a new password"
                    : "Welcome back"}
            </h2>
            {authMode !== "password" && (
              <label>
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
            )}
            {authMode !== "reset" && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  autoComplete={
                    authMode === "signin" ? "current-password" : "new-password"
                  }
                />
              </label>
            )}
            <button className="primary wide">
              {authMode === "signin"
                ? "Sign in"
                : authMode === "register"
                  ? "Create account"
                  : authMode === "password"
                    ? "Save password"
                    : "Send recovery link"}
            </button>
            <div className="auth-links">
              <button
                type="button"
                onClick={() =>
                  setAuthMode(authMode === "register" ? "signin" : "register")
                }
              >
                {authMode === "register" ? "Sign in" : "Create account"}
              </button>
              <button type="button" onClick={() => setAuthMode("reset")}>
                Forgot password?
              </button>
            </div>
          </form>
        )}
        {message && <p role="status">{message}</p>}
      </section>
      <p className="auth-foot">A clearer view of what’s next.</p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
if ("serviceWorker" in navigator && import.meta.env.PROD)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
