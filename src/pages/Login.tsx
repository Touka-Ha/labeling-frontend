import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export default function Login() {
  const nav = useNavigate();
  const { user } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) nav("/app", { replace: true });
  }, [user, nav]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    setBusy(false);
    if (error) setErr(error.message);
    else nav("/app", { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow p-6">
        <h1 className="text-2xl font-bold text-slate-900">منصة تصنيف الفيديوهات</h1>
        <p className="text-slate-600 mt-1">سجّلي الدخول للمتابعة</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="block text-sm text-slate-700 mb-1">Email</label>
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="username"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-700 mb-1">Password</label>
            <input
              className="w-full rounded-xl border border-slate-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-300"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          {err && (
            <div className="rounded-xl bg-red-50 text-red-700 px-3 py-2 text-sm">
              {err}
            </div>
          )}

          <button
            disabled={busy}
            className="w-full rounded-xl bg-slate-900 text-white py-2 font-semibold disabled:opacity-60"
          >
            {busy ? "..." : "دخول"}
          </button>
        </form>

        <p className="text-xs text-slate-500 mt-4">
          الدخول متاح فقط للحسابات التي تمت إضافتها من قبل الإدارة.
        </p>
      </div>
    </div>
  );
}