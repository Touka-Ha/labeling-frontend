import { useEffect, useMemo, useRef, useState } from "react";
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

  // toggles
  const [hasMusic, setHasMusic] = useState(false);
  const [isForeignLanguage, setIsForeignLanguage] = useState(false);

  // to avoid stale values inside realtime callback
  const busyRef = useRef(false);
  const currentRef = useRef<VideoRow | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [soundWanted, setSoundWanted] = useState(true); // نحاول الصوت تلقائيًا
  const [soundBlocked, setSoundBlocked] = useState(false); // هل المتصفح منع الصوت؟

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoUrl) return;

    // نحاول نشغله فورًا (مع سياسات المتصفح لازم يكون muted)
    const t = window.setTimeout(() => {
      el.currentTime = 0;
      el.play().catch(() => {
        // إذا المتصفح منع التشغيل لأي سبب، ما ندير والو
      });
    }, 0);

    return () => window.clearTimeout(t);
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl) return;
    // نخلي المتصفح يحمل metadata ثم نحاول play
    const el = videoRef.current;
    if (!el) return;

    const onLoaded = () => {
      tryAutoPlay();
    };

    el.addEventListener("loadedmetadata", onLoaded);
    return () => el.removeEventListener("loadedmetadata", onLoaded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  const labels = useMemo(
    () => [
      { key: "جيد", color: "bg-emerald-600" },
      { key: "مقبول", color: "bg-amber-600" },
      { key: "سيء", color: "bg-rose-600" },
    ],
    []
  );

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

  async function fetchNextVideo() {
    if (!user) return;

    setBusy(true);
    setStatus(null);
    setCurrent(null);
    setVideoUrl(null);

    const { data, error } = await supabase.rpc("next_video");
    setBusy(false);

    if (error) {
      setStatus("خطأ في next_video(): " + error.message);
      return;
    }

    const v: VideoRow | null = data?.[0] ?? null;

    if (!v) {
      setStatus("✅ لا يوجد فيديو مناسب لك الآن. سيظهر تلقائيًا عند إضافة فيديوهات جديدة.");
      await refreshDoneCount();
      return;
    }

    setCurrent(v);

    // reset toggles for each new video
    setHasMusic(false);
    setIsForeignLanguage(false);

    const { data: signed, error: e3 } = await supabase.storage
      .from(v.storage_bucket)
      .createSignedUrl(v.storage_path, 60 * 60);

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
      has_music: hasMusic,
      is_foreign_language: isForeignLanguage,
    });

    setBusy(false);

    if (error) {
      // ✅ لو كان duplicate (نفس الفيديو نفس المستخدم) نعتبره محسوم ونجيب التالي
      if (error.code === "23505") {
        setStatus("ℹ️ تم تسجيل هذا الفيديو مسبقًا، سيتم الانتقال للفيديو التالي.");
        await fetchNextVideo();
        return;
      }
      setStatus("لم يتم الحفظ: " + error.message);
      return;
    }
    await fetchNextVideo();
  }

  async function skipVideo() {
    if (!user || !current) return;

    setBusy(true);
    setStatus(null);

    const { error } = await supabase.rpc("skip_video", {
      p_video_id: current.id,
      p_reason: "manual_skip",
    });

    setBusy(false);

    if (error) {
      setStatus("لم يتم التخطي: " + error.message);
      return;
    }

    await fetchNextVideo();
  }

  async function tryAutoPlay() {
    const el = videoRef.current;
    if (!el) return;

    // نبدأ من البداية
    try {
      el.currentTime = 0;
    } catch {}

    // (A) محاولة تشغيل بالصوت إذا نريد
    if (soundWanted) {
      try {
        el.muted = false;
        await el.play();
        setSoundBlocked(false);
        return;
      } catch {
        // blocked غالبًا
        setSoundBlocked(true);
      }
    }

    // (B) fallback: تشغيل muted (عادة ينجح)
    try {
      el.muted = true;
      await el.play();
    } catch {
      // حتى muted ممكن يفشل نادرًا (saving mode)، ما نكسرش الواجهة
    }
  }

  useEffect(() => {
    fetchNextVideo();

    const ch = supabase
      .channel("realtime-videos")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "videos" },
        () => {
          // only auto-fetch when user is waiting with no current video
          if (!busyRef.current && !currentRef.current) {
            fetchNextVideo();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
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
                ref={videoRef}
                key={videoUrl}
                src={videoUrl}
                controls
                playsInline
                preload="auto"
                className="w-full rounded-2xl bg-black max-h-[520px]"
              />
            ) : (
              <div className="w-full rounded-2xl bg-slate-100 h-[320px] grid place-items-center text-slate-500">
                {busy ? "تحميل..." : "بانتظار الفيديو..."}
              </div>
            )}
          </div>

          {soundBlocked && (
            <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-slate-100 p-3">
              <div className="text-sm text-slate-700">
                المتصفح منع تشغيل الصوت تلقائيًا. اضغط لتفعيل الصوت (مرة واحدة).
              </div>
              <button
                type="button"
                onClick={async () => {
                  setSoundWanted(true);
                  const el = videoRef.current;
                  if (!el) return;
                  try {
                    el.muted = false;
                    await el.play(); // هذا الآن عنده user gesture، غالبًا ينجح
                    setSoundBlocked(false);
                  } catch {
                    // إذا فشل حتى بعد الضغط، نخليه muted
                    el.muted = true;
                  }
                }}
                className="rounded-xl px-4 py-2 bg-slate-900 text-white font-semibold"
              >
                🔊 تشغيل الصوت
              </button>
            </div>
          )}

          {/* ✅ NEW: Skip button */}
          <div className="mt-4">
            <button
              type="button"
              onClick={skipVideo}
              disabled={!current || busy}
              className="rounded-xl px-4 py-2 font-semibold border border-slate-200 bg-white text-slate-900 disabled:opacity-60"
            >
              تخطي
            </button>
          </div>

          {/* Extra flags (optional) */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHasMusic((v) => !v)}
              disabled={!current || busy}
              className={`rounded-xl px-4 py-2 font-semibold border disabled:opacity-60 ${
                hasMusic
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-900 border-slate-200"
              }`}
            >
              {hasMusic ? "✅ موسيقى" : "موسيقى"}
            </button>

            <button
              type="button"
              onClick={() => setIsForeignLanguage((v) => !v)}
              disabled={!current || busy}
              className={`rounded-xl px-4 py-2 font-semibold border disabled:opacity-60 ${
                isForeignLanguage
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-900 border-slate-200"
              }`}
            >
              {isForeignLanguage ? "✅ لغة أجنبية" : "لغة أجنبية"}
            </button>
          </div>

          {/* Base label buttons (required) */}
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
        </div>
      </div>
    </div>
  );
}