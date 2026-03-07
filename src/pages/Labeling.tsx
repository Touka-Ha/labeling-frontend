import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { useNavigate } from "react-router-dom";

type VideoRow = {
  id: number;
  storage_bucket: string;
  storage_path: string;
  title: string | null;
  created_at?: string;
};

export default function Labeling() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [current, setCurrent] = useState<VideoRow | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countDone, setCountDone] = useState<number>(0);

  const labels = useMemo(() => ([
    { key: "جيد", color: "bg-emerald-600" },
    { key: "مقبول", color: "bg-amber-600" },
    { key: "سيء", color: "bg-rose-600" },
  ]), []);

  async function logout() {
    await supabase.auth.signOut();
    nav("/login", { replace: true });
  }

  async function refreshDoneCount() {
    if (!user) return;
    const { count } = await supabase
      .from("labels")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    setCountDone(count ?? 0);
  }

  // اختيار فيديو غير موسوم لهذا المستخدم (حل بسيط الآن)
  async function fetchNextVideo() {
    if (!user) return;

    setBusy(true);
    setStatus(null);
    setCurrent(null);
    setVideoUrl(null);

    const { data: labeled, error: e1 } = await supabase
      .from("labels")
      .select("video_id")
      .eq("user_id", user.id)
      .limit(5000);

    if (e1) {
      setBusy(false);
      setStatus("خطأ في قراءة labels: " + e1.message);
      return;
    }

    const ids = (labeled ?? [])
      .map((x) => x.video_id)
      .filter((x) => typeof x === "number") as number[];

    let q = supabase
      .from("videos")
      .select("id,storage_bucket,storage_path,title,created_at")
      .order("created_at", { ascending: false })
      .limit(1);

    if (ids.length > 0) {
      q = q.not("id", "in", `(${ids.join(",")})`);
    }

    const { data: vids, error: e2 } = await q;

    if (e2) {
      setBusy(false);
      setStatus("خطأ في قراءة videos: " + e2.message);
      return;
    }

    const v = vids?.[0] ?? null;
    if (!v) {
      setBusy(false);
      setStatus("✅ لا يوجد فيديوهات جديدة غير موسومة لك حاليًا.");
      await refreshDoneCount();
      return;
    }

    setCurrent(v);

    const { data: signed, error: e3 } = await supabase
      .storage
      .from(v.storage_bucket)
      .createSignedUrl(v.storage_path, 60 * 60);

    setBusy(false);

    if (e3 || !signed?.signedUrl) {
      setStatus("خطأ في Signed URL: " + (e3?.message ?? "unknown"));
      return;
    }

    setVideoUrl(signed.signedUrl);
    await refreshDoneCount();
  }

  async function saveLabel(label: string) {
    if (!user || !current) return;
    setBusy(true);
    setStatus(null);

    const { error } = await supabase.from("labels").insert({
      video_id: current.id,
      user_id: user.id,
      label,
    });

    setBusy(false);

    if (error) {
      setStatus("لم يتم الحفظ: " + error.message);
      return;
    }

    await fetchNextVideo();
  }

  useEffect(() => {
    fetchNextVideo();

    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === "1") saveLabel("جيد");
      if (e.key === "2") saveLabel("مقبول");
      if (e.key === "3") saveLabel("سيء");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-2xl shadow p-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">صفحة التصنيف</h1>
            <p className="text-slate-600 text-sm">
              المستخدم: <span className="font-mono">{user?.email}</span> — تم وسم: <b>{countDone}</b>
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchNextVideo}
              className="rounded-xl px-4 py-2 bg-slate-200 text-slate-900 font-semibold disabled:opacity-60"
              disabled={busy}
            >
              تحديث
            </button>
            <button
              onClick={logout}
              className="rounded-xl px-4 py-2 bg-slate-900 text-white font-semibold"
            >
              خروج
            </button>
          </div>
        </div>

        <div className="mt-4 bg-white rounded-2xl shadow p-4">
          {status && (
            <div className="mb-3 rounded-xl bg-amber-50 text-amber-800 px-3 py-2 text-sm">
              {status}
            </div>
          )}

          <div className="text-slate-700">
            {current ? (
              <>
                <div className="font-semibold">Video ID: {current.id}</div>
                <div className="text-sm text-slate-500">{current.title ?? current.storage_path}</div>
              </>
            ) : (
              <div className="text-slate-500">لا يوجد فيديو محمّل حاليًا</div>
            )}
          </div>

          <div className="mt-3">
            {videoUrl ? (
              <video
                key={videoUrl}
                src={videoUrl}
                controls
                playsInline
                className="w-full rounded-2xl bg-black max-h-[520px]"
              />
            ) : (
              <div className="w-full rounded-2xl bg-slate-100 h-[320px] grid place-items-center text-slate-500">
                {busy ? "تحميل..." : "بانتظار الفيديو..."}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {labels.map((x) => (
              <button
                key={x.key}
                onClick={() => saveLabel(x.key)}
                disabled={!current || busy}
                className={`${x.color} text-white rounded-xl px-6 py-3 font-bold disabled:opacity-60`}
              >
                {x.key}
              </button>
            ))}
          </div>

          <p className="mt-3 text-xs text-slate-500">
            اختصارات: 1 = جيد، 2 = مقبول، 3 = سيء
          </p>
        </div>
      </div>
    </div>
  );
}