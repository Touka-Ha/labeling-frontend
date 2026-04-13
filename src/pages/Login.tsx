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
    <div className="min-h-screen p-5 bg-gradient-to-br from-emerald-100 via-green-100 to-teal-100 flex items-center justify-center">
      <div className="w-full max-w-md">
        {/* Card frame */}
        <div className="rounded-3xl p-[2px] bg-gradient-to-r from-emerald-600 via-green-500 to-teal-500 shadow-xl shadow-emerald-200/70">
          <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                  منصة تصنيف الفيديوهات
                </h1>
                <p className="text-slate-600 mt-1">
                  سجّل الدخول للمتابعة
                </p>

                {/* subtle religious touch */}
                <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50/70 px-3 py-1 text-xs text-emerald-800">
                  <span className="font-semibold">﴿ وَقُل رَّبِّ زِدْنِي عِلْمًا ﴾</span>
                </div>
              </div>

              {/* small badge */}
              <div className="shrink-0 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 text-white px-3 py-2 text-xs font-bold shadow-md shadow-emerald-200/60">
                دخول
              </div>
            </div>

            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Email
                </label>
                <input
                  className="
                    w-full rounded-2xl border border-emerald-200/70 bg-white/70
                    px-4 py-3 text-slate-900
                    placeholder:text-slate-400
                    focus:outline-none focus:ring-4 focus:ring-emerald-200/70 focus:border-emerald-300
                    transition
                  "
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Password
                </label>
                <input
                  className="
                    w-full rounded-2xl border border-emerald-200/70 bg-white/70
                    px-4 py-3 text-slate-900
                    placeholder:text-slate-400
                    focus:outline-none focus:ring-4 focus:ring-emerald-200/70 focus:border-emerald-300
                    transition
                  "
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </div>

              {err && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-3 text-sm shadow-sm">
                  {err}
                </div>
              )}

              <button
                disabled={busy}
                className="
                  w-full rounded-2xl py-3 font-extrabold text-white
                  bg-gradient-to-r from-emerald-700 via-green-600 to-teal-600
                  shadow-xl shadow-emerald-200/70
                  hover:from-emerald-600 hover:via-green-500 hover:to-teal-500
                  active:scale-[0.99]
                  transition
                  disabled:opacity-60
                "
              >
                {busy ? "..." : "دخول"}
              </button>
            </form>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-white/60 px-4 py-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                الدخول متاح فقط للحسابات التي تمت إضافتها من قبل الإدارة.
              </p>
            </div>
          </div>
        </div>

        {/* footer hint */}
        <div className="mt-4 text-center text-xs text-slate-600">
          نصيحة: إذا واجهت مشكلة في الدخول، تأكد أن الحساب تم إضافته في Supabase.
        </div>
      </div>
    </div>
  );
}