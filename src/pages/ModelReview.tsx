import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";

type ReviewRow = {
  review_id: number;
  video_id: number;
  true_label: "جيد" | "مقبول" | "سيء";
  pred_label: "جيد" | "مقبول" | "سيء";
  correct: boolean;
  confidence: number | null;
  split: string | null;
  video_name: string | null;
  source_url: string | null;
  permalink: string | null;
  title: string | null;
  embed_status: string | null;
  media_source?: "facebook" | "vps" | string;
  vps_file_url?: string | null;
  download_status?: string | null;
};

type StatusState =
  | { kind: "info" | "success" | "error"; message: string }
  | null;

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

const ALLOWED_USER_IDS = new Set([
  "06e3023c-7082-46a5-8cf2-79fe32a4855d",
  "72077abf-97de-46ee-a95f-125050599bb2",
]);

function buildFacebookEmbedUrl(permalink: string): string {
  const href = encodeURIComponent(permalink);
  return `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&width=380`;
}

export default function ModelReview() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [current, setCurrent] = useState<ReviewRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<StatusState>(null);

  const isMountedRef = useRef(true);

  const embedUrl = useMemo(() => {
    if (!current?.permalink) return null;
    return buildFacebookEmbedUrl(current.permalink);
  }, [current?.permalink]);

  const localVideoUrl = useMemo(() => {
    if (current?.media_source !== "vps") return null;
    if (!current?.vps_file_url) return null;
    return current.vps_file_url;
  }, [current?.media_source, current?.vps_file_url]);

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

  const fetchNextItem = useCallback(async () => {
    if (!user) return;

    setBusy(true);
    setStatus(null);

    const { data, error } = await supabase.rpc("next_model_review_item");

    if (!isMountedRef.current) return;

    setBusy(false);

    if (error) {
      setCurrent(null);
      setStatus({
        kind: "error",
        message: "تعذر جلب الفيديو التالي: " + error.message,
      });
      return;
    }

    const row = Array.isArray(data) ? (data[0] as ReviewRow | undefined) : undefined;

    if (!row) {
      setCurrent(null);
      setStatus({
        kind: "success",
        message: "✅ لا يوجد فيديوات خاطئة غير مراجعة الآن.",
      });
      return;
    }

    setCurrent({
      ...row,
      media_source: row.media_source ?? "facebook",
      vps_file_url: row.vps_file_url ?? null,
      download_status: row.download_status ?? "pending",
    });
  }, [user]);

  const confirmCurrentLabel = useCallback(async () => {
    if (!current || busy) return;

    setBusy(true);
    setStatus(null);

    const { error } = await supabase.rpc("confirm_model_review_current", {
      p_review_id: current.review_id,
    });

    if (!isMountedRef.current) return;

    setBusy(false);

    if (error) {
      setStatus({
        kind: "error",
        message: "لم يتم الحفظ: " + error.message,
      });
      return;
    }

    setStatus({
      kind: "success",
      message: "✅ تم تأكيد أن التصنيف الحالي صحيح.",
    });

    await fetchNextItem();
  }, [busy, current, fetchNextItem]);

  const updateTrueLabel = useCallback(
    async (label: "جيد" | "مقبول" | "سيء") => {
      if (!current || busy) return;

      setBusy(true);
      setStatus(null);

      const { error } = await supabase.rpc("update_model_review_true_label", {
        p_review_id: current.review_id,
        p_true_label: label,
      });

      if (!isMountedRef.current) return;

      setBusy(false);

      if (error) {
        setStatus({
          kind: "error",
          message: "لم يتم تحديث true_label: " + error.message,
        });
        return;
      }

      setStatus({
        kind: "success",
        message: `✅ تم تحديث true_label إلى: ${label}`,
      });

      await fetchNextItem();
    },
    [busy, current, fetchNextItem]
  );

  useEffect(() => {
    if (!user) return;

    if (!ALLOWED_USER_IDS.has(user.id)) {
      setStatus({
        kind: "error",
        message: "غير مصرح لك بدخول هذه الصفحة.",
      });
      return;
    }

    fetchNextItem();
  }, [user, fetchNextItem]);

  if (!user) return null;

  return (
    <div className="min-h-screen p-4 sm:p-5 bg-gradient-to-br from-emerald-100 via-green-100 to-teal-100">
      <div className="max-w-6xl mx-auto space-y-4">
        {status && (
          <div
            className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
              status.kind === "error"
                ? "border-rose-200 bg-rose-50 text-rose-900"
                : status.kind === "success"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-sky-200 bg-sky-50 text-sky-900"
            }`}
          >
            {status.message}
          </div>
        )}

        <div className="rounded-3xl p-[2px] bg-gradient-to-r from-emerald-600 via-green-500 to-teal-500 shadow-xl shadow-emerald-200/60">
          <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-5">
            <div className="flex items-center justify-between gap-4">
              <h1 className="text-2xl font-extrabold text-slate-900">
                مراجعة أخطاء الموديل
              </h1>

              <button
                onClick={logout}
                className="rounded-2xl px-5 py-2.5 text-white font-semibold bg-gradient-to-r from-slate-900 to-slate-800"
              >
                خروج
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-6">
              <div className="flex justify-center">
                {current && localVideoUrl ? (
                  <div className="w-full max-w-[300px]">
                    <div className="rounded-[2rem] bg-slate-900 p-2 shadow-2xl">
                      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[1.6rem] bg-black">
                        <video
                          key={localVideoUrl}
                          src={localVideoUrl}
                          controls
                          playsInline
                          preload="metadata"
                          className="absolute inset-0 h-full w-full object-contain bg-black"
                        />
                      </div>
                    </div>
                  </div>
                ) : current && embedUrl ? (
                  <div className="w-full max-w-[300px]">
                    <div className="rounded-[2rem] bg-slate-900 p-2 shadow-2xl">
                      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-[1.6rem] bg-black">
                        <iframe
                          key={embedUrl}
                          src={embedUrl}
                          title={current.title ?? `review-video-${current.video_id}`}
                          className="absolute inset-0 h-full w-full"
                          style={{ border: "none", overflow: "hidden" }}
                          scrolling="no"
                          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                          allowFullScreen
                          referrerPolicy="strict-origin-when-cross-origin"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="w-full max-w-[300px] rounded-3xl border border-slate-200 bg-white/70 h-[420px] grid place-items-center text-slate-600">
                    {busy ? "تحميل..." : "لا يوجد فيديو"}
                  </div>
                )}
              </div>

              <div className="space-y-4">
                {current ? (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                      <div className="font-bold text-slate-900">
                        Video ID: <span className="font-mono">{current.video_id}</span>
                      </div>

                      <div className="mt-2 text-sm text-slate-600 break-all">
                        {current.title?.trim() || current.permalink || current.source_url}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1">
                          split: <b>{current.split ?? "-"}</b>
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1">
                          confidence: <b>{current.confidence?.toFixed?.(4) ?? "-"}</b>
                        </span>
                        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">
                          source: <b>{current.media_source ?? "facebook"}</b>
                        </span>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="text-sm text-slate-500">التصنيف الحالي (true_label)</div>
                          <div className="mt-2 text-2xl font-extrabold text-slate-900">
                            {current.true_label}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                          <div className="text-sm text-rose-600">توقع الموديل (pred_label)</div>
                          <div className="mt-2 text-2xl font-extrabold text-rose-700">
                            {current.pred_label}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4">
                        <button
                          type="button"
                          onClick={confirmCurrentLabel}
                          disabled={busy}
                          className="w-full rounded-2xl px-6 py-4 font-extrabold text-white bg-gradient-to-r from-slate-900 to-slate-800 disabled:opacity-60"
                        >
                          التصنيف الحالي صحيح
                        </button>
                      </div>

                      <div className="mt-5 grid grid-cols-3 gap-3">
                        {LABEL_OPTIONS.map((x) => (
                          <button
                            key={x.key}
                            onClick={() => updateTrueLabel(x.key)}
                            disabled={busy}
                            className={`${x.color} rounded-2xl px-3 py-4 text-white font-extrabold disabled:opacity-60`}
                          >
                            {x.key}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-white/80 p-6 text-slate-500">
                    {busy ? "جارٍ التحميل..." : "لا يوجد عنصر مراجعة."}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}