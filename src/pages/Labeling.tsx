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
  const [soundWanted, setSoundWanted] = useState(true);
  const [soundBlocked, setSoundBlocked] = useState(false);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoUrl) return;

    const t = window.setTimeout(() => {
      el.currentTime = 0;
      el.play().catch(() => {});
    }, 0);

    return () => window.clearTimeout(t);
  }, [videoUrl]);

  useEffect(() => {
    if (!videoUrl) return;
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
      {
        key: "جيد",
        color:
          "bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 shadow-emerald-200/70",
      },
      {
        key: "مقبول",
        color:
          "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 shadow-amber-200/70",
      },
      {
        key: "سيء",
        color:
          "bg-gradient-to-r from-rose-600 to-pink-500 hover:from-rose-500 hover:to-pink-400 shadow-rose-200/70",
      },
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
      if ((error as any).code === "23505") {
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

    try {
      el.currentTime = 0;
    } catch {}

    if (soundWanted) {
      try {
        el.muted = false;
        await el.play();
        setSoundBlocked(false);
        return;
      } catch {
        setSoundBlocked(true);
      }
    }

    try {
      el.muted = true;
      await el.play();
    } catch {}
  }

  useEffect(() => {
    fetchNextVideo();

    const ch = supabase
      .channel("realtime-videos")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "videos" },
        () => {
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
    <div className="min-h-screen p-5 bg-gradient-to-br from-sky-100 via-indigo-100 to-pink-100">
      <div className="max-w-4xl mx-auto space-y-4">
        {/* Header */}
        <div className="rounded-3xl p-[2px] bg-gradient-to-r from-indigo-500 via-sky-500 to-emerald-500 shadow-xl shadow-indigo-200/60">
          <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                صفحة التصنيف
              </h1>

              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="px-3 py-1 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  المستخدم: <span className="font-mono">{user?.email}</span>
                </span>

                <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100">
                  تم وسم: <b className="text-emerald-900">{countDone}</b>
                </span>
              </div>
            </div>

            <button
              onClick={logout}
              className="rounded-2xl px-5 py-2.5 bg-slate-900 text-white font-semibold shadow-lg shadow-slate-900/10 hover:bg-slate-800 active:scale-[0.99] transition"
            >
              خروج
            </button>
          </div>
        </div>

        {/* Main */}
        <div className="rounded-3xl p-[2px] bg-gradient-to-r from-indigo-500 via-pink-500 to-amber-500 shadow-xl shadow-pink-200/50">
          <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-5">
            {status && (
              <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 px-4 py-3 text-sm shadow-sm">
                {status}
              </div>
            )}

            {/* Meta */}
            <div className="text-slate-800">
              {current ? (
                <>
                  <div className="font-semibold">
                    Video ID: <span className="font-mono">{current.id}</span>
                  </div>
                  <div className="text-sm text-slate-500 mt-0.5 truncate">
                    {current.title ?? current.storage_path}
                  </div>
                </>
              ) : (
                <div className="text-slate-500">لا يوجد فيديو محمّل حاليًا</div>
              )}
            </div>

            {/* Video */}
            <div className="mt-3">
              {videoUrl ? (
                <div className="rounded-3xl overflow-hidden border border-slate-200 shadow-lg shadow-slate-200/60 bg-black">
                  <video
                    ref={videoRef}
                    key={videoUrl}
                    src={videoUrl}
                    controls
                    playsInline
                    preload="auto"
                    className="w-full max-h-[520px]"
                  />
                </div>
              ) : (
                <div className="w-full rounded-3xl border border-slate-200 bg-white/70 h-[320px] grid place-items-center text-slate-600">
                  {busy ? "تحميل..." : "بانتظار الفيديو..."}
                </div>
              )}
            </div>

            {/* Sound */}
            {soundBlocked && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white/80 p-4 shadow-sm">
                <div className="text-sm text-slate-700 leading-relaxed">
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
                      await el.play();
                      setSoundBlocked(false);
                    } catch {
                      el.muted = true;
                    }
                  }}
                  className="rounded-2xl px-5 py-2.5 text-white font-semibold bg-gradient-to-r from-indigo-600 to-sky-600 shadow-lg shadow-indigo-200/70 hover:from-indigo-500 hover:to-sky-500 active:scale-[0.99] transition"
                >
                  🔊 تشغيل الصوت
                </button>
              </div>
            )}

            {/* Skip */}
            <div className="mt-4">
              <button
                type="button"
                onClick={skipVideo}
                disabled={!current || busy}
                className="
                  rounded-2xl px-6 py-3 font-extrabold text-white
                  bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-600
                  shadow-xl shadow-fuchsia-200/70
                  hover:from-violet-500 hover:via-fuchsia-500 hover:to-pink-500
                  active:scale-[0.99] transition
                  disabled:opacity-60
                "
              >
                تخطي
              </button>
            </div>

            {/* Flags */}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setHasMusic((v) => !v)}
                disabled={!current || busy}
                className={`rounded-2xl px-4 py-2 font-semibold border shadow-sm transition active:scale-[0.99] disabled:opacity-60 ${
                  hasMusic
                    ? "bg-gradient-to-r from-slate-900 to-slate-700 text-white border-slate-900"
                    : "bg-white/80 text-slate-900 border-slate-200 hover:bg-white"
                }`}
              >
                {hasMusic ? "✅ موسيقى" : "موسيقى"}
              </button>

              <button
                type="button"
                onClick={() => setIsForeignLanguage((v) => !v)}
                disabled={!current || busy}
                className={`rounded-2xl px-4 py-2 font-semibold border shadow-sm transition active:scale-[0.99] disabled:opacity-60 ${
                  isForeignLanguage
                    ? "bg-gradient-to-r from-slate-900 to-slate-700 text-white border-slate-900"
                    : "bg-white/80 text-slate-900 border-slate-200 hover:bg-white"
                }`}
              >
                {isForeignLanguage ? "✅ لغة أجنبية" : "لغة أجنبية"}
              </button>
            </div>

            {/* Labels */}
            <div className="mt-4 flex flex-wrap gap-3 justify-end">
              {labels.map((x) => (
                <button
                  key={x.key}
                  onClick={() => saveLabel(x.key)}
                  disabled={!current || busy}
                  className={`
                    ${x.color}
                    text-white rounded-3xl px-8 py-3
                    font-extrabold
                    shadow-xl
                    hover:brightness-110
                    active:scale-[0.99]
                    transition
                    disabled:opacity-60
                  `}
                >
                  {x.key}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}