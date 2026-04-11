import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";

type VideoRow = {
  id: number;
  permalink: string;
  title: string | null;
  embed_status: "unknown" | "ok" | "broken" | "blocked" | "private" | "deleted" | string;
};

type StatusKind = "info" | "success" | "error";

type StatusState = {
  kind: StatusKind;
  message: string;
} | null;

const LABEL_OPTIONS = [
  {
    key: "جيد" as const,
    color:
      "bg-gradient-to-r from-emerald-700 to-teal-600 hover:from-emerald-600 hover:to-teal-500 shadow-emerald-200/70",
  },
  {
    key: "مقبول" as const,
    color:
      "bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-400 hover:to-yellow-500 shadow-yellow-200/70",
  },
  {
    key: "سيء" as const,
    color:
      "bg-gradient-to-r from-rose-600 to-pink-500 hover:from-rose-500 hover:to-pink-400 shadow-rose-200/70",
  },
];

function buildFacebookEmbedUrl(permalink: string): string {
  const href = encodeURIComponent(permalink);
  return `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&width=380`;
}

function statusClasses(kind?: StatusKind): string {
  switch (kind) {
    case "error":
      return "border-rose-200 bg-rose-50 text-rose-900";
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-900";
    default:
      return "border-sky-200 bg-sky-50 text-sky-900";
  }
}

export default function Labeling() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [current, setCurrent] = useState<VideoRow | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [countDone, setCountDone] = useState<number>(0);

  const [hasMusic, setHasMusic] = useState<boolean>(false);
  const [isForeignLanguage, setIsForeignLanguage] = useState<boolean>(false);

  const [status, setStatus] = useState<StatusState>(null);

  const isMountedRef = useRef<boolean>(true);
  const fetchSeqRef = useRef<number>(0);

  const embedUrl = useMemo(() => {
    if (!current?.permalink) return null;
    return buildFacebookEmbedUrl(current.permalink);
  }, [current?.permalink]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    nav("/login", { replace: true });
  }, [nav]);

  const refreshDoneCount = useCallback(async () => {
    if (!user) return;

    const { count, error } = await supabase
      .from("labels")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (!error && isMountedRef.current) {
      setCountDone(count ?? 0);
    }
  }, [user]);

  const fetchNextVideo = useCallback(
    async (opts?: { keepStatus?: boolean }) => {
      if (!user) return;

      const seq = ++fetchSeqRef.current;

      if (isMountedRef.current) {
        setBusy(true);
        if (!opts?.keepStatus) setStatus(null);
      }

      await refreshDoneCount();

      const { data, error } = await supabase.rpc("next_video");

      if (!isMountedRef.current || seq !== fetchSeqRef.current) return;

      if (error) {
        setBusy(false);
        setCurrent(null);
        setStatus({
          kind: "error",
          message: "تعذر جلب الفيديو التالي: " + error.message,
        });
        return;
      }

      const row = Array.isArray(data) ? (data[0] as VideoRow | undefined) : undefined;

      setBusy(false);

      if (!row) {
        setCurrent(null);
        setStatus({
          kind: "success",
          message: "✅ لا يوجد فيديو مناسب لك الآن.",
        });
        return;
      }

      setCurrent(row);
      setHasMusic(false);
      setIsForeignLanguage(false);
      setStatus(null);
    },
    [refreshDoneCount, user]
  );

  const saveLabel = useCallback(
    async (label: "جيد" | "مقبول" | "سيء") => {
      if (!user || !current || busy) return;

      setBusy(true);
      setStatus(null);

      const { error } = await supabase.rpc("submit_label", {
        p_video_id: current.id,
        p_label: label,
        p_has_music: hasMusic,
        p_is_foreign_language: isForeignLanguage,
      });

      if (!isMountedRef.current) return;

      if (error) {
        setBusy(false);

        const msg = error.message || "";

        const shouldMoveNext =
          msg.includes("video already completed") ||
          msg.includes("already labeled") ||
          msg.includes("no active assignment");

        if (shouldMoveNext) {
          setStatus({
            kind: "info",
            message: "ℹ️ هذا الفيديو لم يعد متاحًا لك، سيتم الانتقال للفيديو التالي.",
          });
          await fetchNextVideo({ keepStatus: true });
          return;
        }

        setStatus({
          kind: "error",
          message: "لم يتم حفظ التصنيف: " + msg,
        });
        return;
      }

      setStatus({
        kind: "success",
        message: `✅ تم حفظ التصنيف: ${label}`,
      });

      await refreshDoneCount();
      await fetchNextVideo({ keepStatus: true });
    },
    [busy, current, fetchNextVideo, hasMusic, isForeignLanguage, refreshDoneCount, user]
  );

  const skipVideo = useCallback(async () => {
    if (!user || !current || busy) return;

    setBusy(true);
    setStatus(null);

    const { error } = await supabase.rpc("skip_video", {
      p_video_id: current.id,
      p_reason: "manual_skip",
    });

    if (!isMountedRef.current) return;

    if (error) {
      setBusy(false);
      setStatus({
        kind: "error",
        message: "لم يتم التخطي: " + error.message,
      });
      return;
    }

    setStatus({
      kind: "info",
      message: "تم تخطي الفيديو وسيظهر التالي مباشرة.",
    });

    await refreshDoneCount();
    await fetchNextVideo({ keepStatus: true });
  }, [busy, current, fetchNextVideo, refreshDoneCount, user]);

  useEffect(() => {
    if (!user) return;
    refreshDoneCount();
    fetchNextVideo();
  }, [fetchNextVideo, refreshDoneCount, user]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!current || busy) return;

      const target = e.target as HTMLElement | null;
      const tag = (target?.tagName || "").toLowerCase();

      if (tag === "input" || tag === "textarea" || target?.isContentEditable) return;

      if (e.key === "1") {
        e.preventDefault();
        void saveLabel("جيد");
      } else if (e.key === "2") {
        e.preventDefault();
        void saveLabel("مقبول");
      } else if (e.key === "3") {
        e.preventDefault();
        void saveLabel("سيء");
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        void skipVideo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, current, saveLabel, skipVideo]);

  const openCurrentInNewTab = useCallback(() => {
    if (!current?.permalink) return;
    window.open(current.permalink, "_blank", "noopener,noreferrer");
  }, [current?.permalink]);

  const compactToggleClass = (active: boolean) =>
    `rounded-2xl px-3 py-2 text-[13px] font-semibold border shadow-sm transition active:scale-[0.99] disabled:opacity-60 ${
      active
        ? "bg-gradient-to-r from-emerald-900 to-emerald-700 text-white border-emerald-900"
        : "bg-white/90 text-slate-900 border-emerald-200 hover:bg-white"
    }`;

  return (
    <div className="min-h-screen p-3 sm:p-5 pb-40 sm:pb-5 bg-gradient-to-br from-emerald-100 via-green-100 to-teal-100">
      <div className="max-w-6xl mx-auto space-y-4">
        {status && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${statusClasses(
              status.kind
            )}`}
          >
            {status.message}
          </div>
        )}

        <div className="hidden sm:block">
          <div className="rounded-[2rem] border-2 border-emerald-700/70 bg-white/70 backdrop-blur-xl shadow-xl overflow-hidden">
            <div className="border-b-2 border-emerald-700/60 px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm text-slate-700 font-medium">
                  اختصارات: 1 جيد · 2 مقبول · 3 سيء · S تخطي
                </div>
                <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
                  صفحة التصنيف
                </h1>
              </div>
            </div>

            <div className="p-5 lg:p-6">
              <div className="grid grid-cols-[300px_minmax(0,1fr)] gap-5 lg:gap-6">
                <div className="flex items-start justify-center">
                  {current && embedUrl ? (
                    <div className="w-full max-w-[290px]">
                      <div className="rounded-[2rem] bg-slate-900 p-2 shadow-2xl shadow-slate-400/30">
                        <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[1.6rem] bg-black">
                          <iframe
                            key={embedUrl}
                            src={embedUrl}
                            title={current.title ?? `facebook-video-${current.id}`}
                            className={`absolute inset-0 h-full w-full transition-opacity ${
                              busy ? "opacity-60" : "opacity-100"
                            }`}
                            style={{ border: "none", overflow: "hidden" }}
                            scrolling="no"
                            allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                            allowFullScreen
                            referrerPolicy="strict-origin-when-cross-origin"
                          />

                          {busy && (
                            <div className="absolute inset-0 z-10 grid place-items-center bg-black/25">
                              <div className="rounded-2xl bg-white/90 px-4 py-2 text-sm font-semibold text-slate-800 shadow">
                                جارٍ تحميل الفيديو التالي...
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full max-w-[290px] rounded-[2rem] border border-slate-200 bg-white/70 aspect-[9/16] grid place-items-center text-slate-600">
                      {busy ? "تحميل..." : "بانتظار الفيديو..."}
                    </div>
                  )}
                </div>

                <div className="flex min-h-full flex-col">
                  <div className="rounded-3xl border-2 border-slate-300 bg-white/80 px-5 py-4">
                    {current ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={openCurrentInNewTab}
                            className="shrink-0 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50"
                          >
                            فتح على Facebook
                          </button>

                          <div className="text-lg font-bold text-slate-900">
                            Video ID: <span className="font-mono">{current.id}</span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-4">
                          <div
                            dir="ltr"
                            className="min-w-0 flex-1 truncate text-sm text-slate-600"
                            title={current.title?.trim() ? current.title : current.permalink}
                          >
                            {current.title?.trim() ? current.title : current.permalink}
                          </div>

                          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-700">
                            embed_status: <b>{current.embed_status}</b>
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-slate-500">لا يوجد فيديو محمّل حاليًا</div>
                    )}
                  </div>

                  <div className="mt-3 text-center text-xs text-slate-500">
                    إذا لم يظهر الفيديو، افتحيه من زر <span className="font-semibold">فتح على Facebook</span>
                  </div>

                  <div className="mt-4 rounded-3xl border-2 border-slate-300 bg-white/80 px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="text-lg font-bold text-slate-800">Tags:</div>

                      <button
                        type="button"
                        onClick={() => setHasMusic((v) => !v)}
                        disabled={!current || busy}
                        className={`rounded-2xl px-4 py-2 text-sm font-semibold border shadow-sm transition active:scale-[0.99] disabled:opacity-60 ${
                          hasMusic
                            ? "bg-gradient-to-r from-emerald-900 to-emerald-700 text-white border-emerald-900"
                            : "bg-white/80 text-slate-900 border-emerald-200 hover:bg-white"
                        }`}
                      >
                        {hasMusic ? "✅ موسيقى" : "موسيقى"}
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsForeignLanguage((v) => !v)}
                        disabled={!current || busy}
                        className={`rounded-2xl px-4 py-2 text-sm font-semibold border shadow-sm transition active:scale-[0.99] disabled:opacity-60 ${
                          isForeignLanguage
                            ? "bg-gradient-to-r from-emerald-900 to-emerald-700 text-white border-emerald-900"
                            : "bg-white/80 text-slate-900 border-emerald-200 hover:bg-white"
                        }`}
                      >
                        {isForeignLanguage ? "✅ لغة أجنبية" : "لغة أجنبية"}
                      </button>

                      <button
                        type="button"
                        onClick={() => fetchNextVideo()}
                        disabled={busy}
                        className="rounded-2xl px-4 py-2 text-sm font-semibold border border-slate-200 bg-white/80 text-slate-900 shadow-sm transition active:scale-[0.99] disabled:opacity-60 hover:bg-white"
                      >
                        تحديث
                      </button>
                    </div>
                  </div>

                  <div className="mt-auto pt-8">
                    <div className="grid grid-cols-3 gap-4">
                      {LABEL_OPTIONS.map((x) => (
                        <button
                          key={x.key}
                          onClick={() => saveLabel(x.key)}
                          disabled={!current || busy}
                          className={`
                            ${x.color}
                            w-full min-w-0 whitespace-nowrap rounded-3xl
                            px-3 py-4 text-base font-extrabold text-white
                            shadow-xl transition hover:brightness-110 active:scale-[0.99]
                            disabled:opacity-60
                          `}
                        >
                          {x.key}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={skipVideo}
                        disabled={!current || busy}
                        className="w-full rounded-3xl px-6 py-4 font-extrabold text-white
                                   bg-gradient-to-r from-emerald-800 via-green-700 to-teal-700
                                   shadow-xl shadow-emerald-200/70 hover:from-emerald-700 hover:via-green-600 hover:to-teal-600
                                   active:scale-[0.99] transition disabled:opacity-60"
                      >
                        تخطي
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t-2 border-emerald-700/60 px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <button
                  onClick={logout}
                  className="rounded-2xl px-6 py-3 text-white font-semibold
                             bg-gradient-to-r from-slate-900 to-slate-800
                             shadow-lg shadow-slate-900/10 hover:from-slate-800 hover:to-slate-700
                             active:scale-[0.99] transition"
                >
                  خروج
                </button>

                <div className="flex items-center gap-2 text-sm">
                  <span className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-slate-700">
                    المستخدم: <span className="font-mono">{user?.email}</span>
                  </span>

                  <span className="rounded-full border border-emerald-200 bg-emerald-50/80 px-3 py-1 text-emerald-800">
                    تم وسم: <b className="text-emerald-950">{countDone}</b>
                  </span>
                </div>
              </div>

              <div className="mt-3 text-xs text-slate-600 text-right">
                تذكير: اضبطوا النية واحتسبوا الأجر — هذا عمل لخدمة الدين إن شاء الله.
              </div>
            </div>
          </div>
        </div>

        <div className="sm:hidden">
          <div className="rounded-3xl p-[2px] bg-gradient-to-r from-emerald-600 via-green-500 to-teal-500 shadow-xl shadow-emerald-200/60">
            <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-4 sm:p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900">
                    صفحة التصنيف
                  </h1>

                  <div className="mt-2">
                    <span className="inline-flex px-3 py-1 rounded-full bg-emerald-50/80 text-emerald-800 border border-emerald-200 text-xs sm:text-sm">
                      ﴿ فَادْعُوا اللَّهَ مُخْلِصِينَ لَهُ الدِّينَ وَلَوْ كَرِهَ الْكَافِرُونَ ﴾ [غافر:14]
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white/70 px-3 py-3 sm:px-4">
                {current ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={openCurrentInNewTab}
                        className="shrink-0 px-3 py-1 rounded-full bg-white text-slate-800 border border-slate-300 text-[12px] sm:text-xs font-semibold hover:bg-slate-50 transition"
                      >
                        فتح على Facebook
                      </button>

                      <div className="font-semibold text-slate-900 text-sm sm:text-base whitespace-nowrap">
                        Video ID: <span className="font-mono">{current.id}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <span className="shrink-0 px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[11px] sm:text-xs whitespace-nowrap">
                        embed_status: <b>{current.embed_status}</b>
                      </span>

                      <div
                        dir="ltr"
                        className="min-w-0 flex-1 text-[12px] sm:text-sm text-slate-600 text-left truncate"
                        title={current.title?.trim() ? current.title : current.permalink}
                      >
                        {current.title?.trim() ? current.title : current.permalink}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-slate-500 text-sm">
                    {busy ? "جارٍ تحميل الفيديو التالي..." : "لا يوجد فيديو محمّل حاليًا"}
                  </div>
                )}
              </div>

              <div className="mt-5">
                {current && embedUrl ? (
                  <div className="mx-auto w-full max-w-[420px]">
                    <div className="rounded-[2rem] bg-slate-900 p-2 shadow-2xl shadow-slate-400/30">
                      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[1.6rem] bg-black">
                        <iframe
                          key={embedUrl}
                          src={embedUrl}
                          title={current.title ?? `facebook-video-${current.id}`}
                          className={`absolute inset-0 h-full w-full transition-opacity ${
                            busy ? "opacity-60" : "opacity-100"
                          }`}
                          style={{ border: "none", overflow: "hidden" }}
                          scrolling="no"
                          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                          allowFullScreen
                          referrerPolicy="strict-origin-when-cross-origin"
                        />

                        {busy && (
                          <div className="absolute inset-0 z-10 grid place-items-center bg-black/20">
                            <div className="rounded-2xl bg-white/90 px-4 py-2 text-sm font-semibold text-slate-800 shadow">
                              جارٍ تحميل الفيديو التالي...
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full rounded-3xl border border-slate-200 bg-white/70 h-[420px] grid place-items-center text-slate-600">
                    {busy ? "تحميل..." : "بانتظار الفيديو..."}
                  </div>
                )}

                {current && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-xs sm:text-sm text-slate-700 text-center">
                    إذا لم يظهر الفيديو،افتح من زر <span className="font-semibold">فتح على Facebook</span>
                  </div>
                )}
              </div>

              <div className="mt-5 text-xs text-slate-600 text-right">
                تذكير: اضبطوا النية واحتسبوا الأجر — هذا عمل لخدمة الدين إن شاء الله.
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-3xl p-[2px] bg-gradient-to-r from-emerald-600 via-green-500 to-teal-500 shadow-xl shadow-emerald-200/70">
            <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-4 sm:p-5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="px-3 py-1 rounded-full bg-white/70 text-slate-700 border border-slate-200">
                  المستخدم: <span className="font-mono">{user?.email}</span>
                </span>

                <span className="px-3 py-1 rounded-full bg-emerald-50/80 text-emerald-800 border border-emerald-200">
                  تم وسم: <b className="text-emerald-950">{countDone}</b>
                </span>
              </div>

              <button
                onClick={logout}
                className="rounded-2xl px-5 py-2.5 text-white font-semibold
                           bg-gradient-to-r from-slate-900 to-slate-800
                           shadow-lg shadow-slate-900/10 hover:from-slate-800 hover:to-slate-700
                           active:scale-[0.99] transition"
              >
                خروج
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="sm:hidden fixed inset-x-0 bottom-0 z-40 px-3 pb-3">
        <div className="mx-auto max-w-5xl rounded-3xl border border-emerald-200 bg-white/95 backdrop-blur-xl p-3 shadow-2xl shadow-slate-900/10">
          <div className="grid grid-cols-3 gap-2">
            {LABEL_OPTIONS.map((x) => (
              <button
                key={x.key}
                onClick={() => saveLabel(x.key)}
                disabled={!current || busy}
                className={`
                  ${x.color}
                  min-w-0 whitespace-nowrap
                  rounded-2xl py-2.5 px-1
                  text-[13px] font-extrabold text-white
                  shadow-lg transition active:scale-[0.99]
                  disabled:opacity-60
                `}
              >
                {x.key}
              </button>
            ))}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setHasMusic((v) => !v)}
              disabled={!current || busy}
              className={compactToggleClass(hasMusic)}
            >
              {hasMusic ? "✅ موسيقى" : "موسيقى"}
            </button>

            <button
              type="button"
              onClick={() => setIsForeignLanguage((v) => !v)}
              disabled={!current || busy}
              className={compactToggleClass(isForeignLanguage)}
            >
              {isForeignLanguage ? "✅ لغة أجنبية" : "لغة أجنبية"}
            </button>

            <button
              type="button"
              onClick={skipVideo}
              disabled={!current || busy}
              className="rounded-2xl px-3 py-2 text-[13px] font-bold text-white bg-gradient-to-r from-emerald-800 via-green-700 to-teal-700 shadow-sm transition active:scale-[0.99] disabled:opacity-60"
            >
              تخطي
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}