import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Papa from "papaparse";
import { useAuth } from "../auth/AuthProvider";
import { supabase } from "../lib/supabase";

type StatusKind = "info" | "success" | "error";

type StatusState = {
  kind: StatusKind;
  message: string;
} | null;

type BulkResultRow = {
  raw_permalink: string | null;
  permalink_norm: string | null;
  status: "inserted" | "duplicate" | "invalid" | string;
  video_id: number | null;
};

type VideoRow = {
  id: number;
  permalink: string;
  permalink_norm: string;
  title: string | null;
  is_active: boolean;
  embed_status: "unknown" | "ok" | "broken" | "blocked" | "private" | "deleted" | string;
  failure_reason: string | null;
  created_at: string | null;
  last_checked_at: string | null;
};

type UploadSummary = {
  totalInput: number;
  inserted: number;
  duplicate: number;
  invalid: number;
};

const BATCH_SIZE = 400;

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

function normalizeHeaderKey(key: string): string {
  return key.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

export default function Admin() {
  const { user } = useAuth();
  const nav = useNavigate();

  const [status, setStatus] = useState<StatusState>(null);

  const [checkingAdmin, setCheckingAdmin] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");

  const [summary, setSummary] = useState<UploadSummary>({
    totalInput: 0,
    inserted: 0,
    duplicate: 0,
    invalid: 0,
  });

  const [results, setResults] = useState<BulkResultRow[]>([]);
  const [recentVideos, setRecentVideos] = useState<VideoRow[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(false);

  const canDownloadReport = useMemo(() => results.length > 0, [results.length]);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    nav("/login", { replace: true });
  }, [nav]);

  const checkAdmin = useCallback(async () => {
    setCheckingAdmin(true);
    setStatus(null);

    const { data, error } = await supabase.rpc("is_admin");

    if (error) {
      setCheckingAdmin(false);
      setIsAdmin(false);
      setStatus({
        kind: "error",
        message: "تعذر التحقق من صلاحية الإدارة: " + error.message,
      });
      return;
    }

    setIsAdmin(Boolean(data));
    setCheckingAdmin(false);

    if (!data) {
      setStatus({
        kind: "error",
        message: "هذه الصفحة للإدارة فقط.",
      });
    }
  }, []);

  const fetchRecentVideos = useCallback(async () => {
    if (!isAdmin) return;

    setLoadingVideos(true);

    const { data, error } = await supabase
      .from("videos")
      .select(
        "id, permalink, permalink_norm, title, is_active, embed_status, failure_reason, created_at, last_checked_at"
      )
      .order("id", { ascending: false })
      .limit(50);

    setLoadingVideos(false);

    if (error) {
      setStatus({
        kind: "error",
        message: "تعذر جلب الفيديوهات: " + error.message,
      });
      return;
    }

    setRecentVideos((data ?? []) as VideoRow[]);
  }, [isAdmin]);

  useEffect(() => {
    if (!user) return;
    void checkAdmin();
  }, [checkAdmin, user]);

  useEffect(() => {
    if (!isAdmin) return;
    void fetchRecentVideos();
  }, [fetchRecentVideos, isAdmin]);

  const extractPermalinksFromCsv = useCallback(async (file: File): Promise<string[]> => {
    const text = await file.text();

    const parsed = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      transformHeader: (header) => normalizeHeaderKey(header),
    });

    // لا نوقف الرفع بسبب أخطاء عدد الأعمدة
    const fatalErrors = (parsed.errors ?? []).filter((err) => {
      const msg = String(err.message || "").toLowerCase();

      // هذه الأخطاء نتجاوزها لأنها لا تهمنا طالما نستطيع أخذ permalink
      if (
        msg.includes("too many fields") ||
        msg.includes("too few fields") ||
        msg.includes("field mismatch")
      ) {
        return false;
      }

      return true;
    });

    if (fatalErrors.length > 0) {
      const firstError = fatalErrors[0];
      throw new Error(firstError.message || "CSV parsing failed");
    }

    const rows = parsed.data ?? [];
    if (!rows.length) {
      throw new Error("الملف فارغ أو لا يحتوي صفوفًا صالحة.");
    }

  // بعد transformHeader صار اسم العمود normalized
    const hasPermalinkColumn = Object.prototype.hasOwnProperty.call(rows[0] ?? {}, "permalink");

    if (!hasPermalinkColumn) {
      throw new Error("لم أجد عمودًا باسم permalink داخل ملف CSV.");
    }

    const urls = rows
      .map((row) => String(row["permalink"] ?? "").trim())
      .filter((value) => value.length > 0);

  // إزالة التكرار الخام داخل الملف نفسه
    const deduped = Array.from(new Set(urls));

    if (!deduped.length) {
      throw new Error("عمود permalink موجود لكن لا يحتوي روابط صالحة.");
    }

    return deduped;
  }, []);

  const handleUploadCsv = useCallback(async () => {
    if (!isAdmin) return;

    if (!csvFile) {
      setStatus({
        kind: "error",
        message: "اختاري ملف CSV أولًا.",
      });
      return;
    }

    try {
      setUploadBusy(true);
      setStatus(null);
      setUploadProgress("جارٍ قراءة الملف...");
      setResults([]);
      setSummary({
        totalInput: 0,
        inserted: 0,
        duplicate: 0,
        invalid: 0,
      });

      const permalinks = await extractPermalinksFromCsv(csvFile);

      setSummary({
        totalInput: permalinks.length,
        inserted: 0,
        duplicate: 0,
        invalid: 0,
      });

      const allResults: BulkResultRow[] = [];
      let inserted = 0;
      let duplicate = 0;
      let invalid = 0;

      const totalBatches = Math.ceil(permalinks.length / BATCH_SIZE);

      for (let i = 0; i < permalinks.length; i += BATCH_SIZE) {
        const batch = permalinks.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

        setUploadProgress(
          `جارٍ رفع الدفعة ${batchIndex} من ${totalBatches} (${i + 1} - ${i + batch.length})`
        );

        const { data, error } = await supabase.rpc("admin_bulk_add_videos", {
          p_permalinks: batch,
        });

        if (error) {
          throw new Error(error.message);
        }

        const batchResults = ((data ?? []) as BulkResultRow[]).map((row) => ({
          raw_permalink: row.raw_permalink ?? null,
          permalink_norm: row.permalink_norm ?? null,
          status: row.status ?? "unknown",
          video_id: row.video_id ?? null,
        }));

        for (const row of batchResults) {
          if (row.status === "inserted") inserted += 1;
          else if (row.status === "duplicate") duplicate += 1;
          else if (row.status === "invalid") invalid += 1;
        }

        allResults.push(...batchResults);

        setSummary({
          totalInput: permalinks.length,
          inserted,
          duplicate,
          invalid,
        });

        // نعرض آخر 200 نتيجة فقط داخل الصفحة حتى لا تثقل الواجهة
        setResults(allResults.slice(-200));
      }

      setUploadBusy(false);
      setUploadProgress("");
      setStatus({
        kind: "success",
        message: `تمت معالجة الملف بنجاح. أُضيف ${inserted} رابطًا جديدًا.`,
      });

      await fetchRecentVideos();
    } catch (err) {
      setUploadBusy(false);
      setUploadProgress("");
      setStatus({
        kind: "error",
        message: err instanceof Error ? err.message : "فشل رفع الملف.",
      });
    }
  }, [csvFile, extractPermalinksFromCsv, fetchRecentVideos, isAdmin]);

  const downloadReportCsv = useCallback(() => {
    if (!results.length) return;

    const header = ["raw_permalink", "permalink_norm", "status", "video_id"];
    const rows = results.map((r) => [
      r.raw_permalink ?? "",
      r.permalink_norm ?? "",
      r.status ?? "",
      r.video_id ?? "",
    ]);

    const csvText = [header, ...rows]
      .map((row) =>
        row
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "admin_bulk_import_report.csv";
    a.click();

    URL.revokeObjectURL(url);
  }, [results]);

  const handleVideoFieldChange = useCallback(
    <K extends keyof VideoRow>(videoId: number, key: K, value: VideoRow[K]) => {
      setRecentVideos((prev) =>
        prev.map((row) => (row.id === videoId ? { ...row, [key]: value } : row))
      );
    },
    []
  );

  const saveVideoStatus = useCallback(
    async (row: VideoRow) => {
      setStatus(null);

      const { error } = await supabase.rpc("admin_update_video_status", {
        p_video_id: row.id,
        p_is_active: row.is_active,
        p_embed_status: row.embed_status,
        p_failure_reason: row.failure_reason?.trim() ? row.failure_reason.trim() : null,
      });

      if (error) {
        setStatus({
          kind: "error",
          message: `تعذر تحديث الفيديو #${row.id}: ${error.message}`,
        });
        return;
      }

      setStatus({
        kind: "success",
        message: `تم تحديث الفيديو #${row.id} بنجاح.`,
      });

      await fetchRecentVideos();
    },
    [fetchRecentVideos]
  );

  if (checkingAdmin) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-emerald-100 via-green-100 to-teal-100">
        <div className="rounded-3xl border border-emerald-200 bg-white/80 px-6 py-4 text-slate-700 shadow-lg">
          جارٍ التحقق من صلاحيات الإدارة...
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center bg-gradient-to-br from-emerald-100 via-green-100 to-teal-100 p-5">
        <div className="max-w-xl w-full rounded-3xl border border-rose-200 bg-white/90 p-6 shadow-xl">
          {status && (
            <div className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${statusClasses(status.kind)}`}>
              {status.message}
            </div>
          )}

          <h1 className="text-2xl font-extrabold text-slate-900">صفحة الإدارة</h1>
          <p className="mt-2 text-slate-600">ليس لديك صلاحية للوصول إلى هذه الصفحة.</p>

          <div className="mt-5 flex gap-3">
            <button
              onClick={() => nav("/")}
              className="rounded-2xl px-5 py-2.5 text-white font-semibold bg-gradient-to-r from-emerald-700 to-teal-600"
            >
              العودة
            </button>

            <button
              onClick={logout}
              className="rounded-2xl px-5 py-2.5 text-white font-semibold bg-gradient-to-r from-slate-900 to-slate-800"
            >
              خروج
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-5 bg-gradient-to-br from-emerald-100 via-green-100 to-teal-100">
      <div className="max-w-7xl mx-auto space-y-4">
        <div className="rounded-3xl p-[2px] bg-gradient-to-r from-emerald-600 via-green-500 to-teal-500 shadow-xl shadow-emerald-200/60">
          <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-5">
            {status && (
              <div
                className={`mb-4 rounded-2xl border px-4 py-3 text-sm shadow-sm ${statusClasses(
                  status.kind
                )}`}
              >
                {status.message}
              </div>
            )}

            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
                  صفحة الإدارة
                </h1>
                <div className="mt-2 text-sm text-slate-600">
                  المستخدم الحالي: <span className="font-mono">{user?.email}</span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => nav("/")}
                  className="rounded-2xl px-5 py-2.5 text-white font-semibold bg-gradient-to-r from-emerald-700 to-teal-600"
                >
                  صفحة التصنيف
                </button>

                <button
                  onClick={logout}
                  className="rounded-2xl px-5 py-2.5 text-white font-semibold bg-gradient-to-r from-slate-900 to-slate-800"
                >
                  خروج
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl p-[2px] bg-gradient-to-r from-emerald-600 via-green-500 to-teal-500 shadow-xl shadow-emerald-200/60">
          <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-5">
            <h2 className="text-xl font-extrabold text-slate-900">رفع CSV وإضافة الفيديوهات</h2>
            <p className="mt-2 text-sm text-slate-600">
              يجب أن يحتوي الملف على عمود باسم <span className="font-mono">permalink</span>.
            </p>

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
                className="block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm"
              />

              <button
                type="button"
                onClick={handleUploadCsv}
                disabled={uploadBusy || !csvFile}
                className="rounded-2xl px-6 py-3 text-white font-bold bg-gradient-to-r from-emerald-800 via-green-700 to-teal-700 shadow-xl disabled:opacity-60"
              >
                {uploadBusy ? "جارٍ الرفع..." : "رفع الملف"}
              </button>

              <button
                type="button"
                onClick={downloadReportCsv}
                disabled={!canDownloadReport}
                className="rounded-2xl px-6 py-3 text-slate-900 font-bold bg-white border border-slate-200 shadow-sm disabled:opacity-60"
              >
                تنزيل تقرير آخر رفع
              </button>
            </div>

            {csvFile && (
              <div className="mt-3 text-sm text-slate-700">
                الملف المختار: <span className="font-semibold">{csvFile.name}</span>
              </div>
            )}

            {uploadProgress && (
              <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                {uploadProgress}
              </div>
            )}

            <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white/90 p-4">
                <div className="text-sm text-slate-500">إجمالي الروابط</div>
                <div className="mt-1 text-2xl font-extrabold text-slate-900">{summary.totalInput}</div>
              </div>

              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/90 p-4">
                <div className="text-sm text-emerald-700">أضيفت</div>
                <div className="mt-1 text-2xl font-extrabold text-emerald-900">{summary.inserted}</div>
              </div>

              <div className="rounded-2xl border border-yellow-200 bg-yellow-50/90 p-4">
                <div className="text-sm text-yellow-700">مكررة</div>
                <div className="mt-1 text-2xl font-extrabold text-yellow-900">{summary.duplicate}</div>
              </div>

              <div className="rounded-2xl border border-rose-200 bg-rose-50/90 p-4">
                <div className="text-sm text-rose-700">غير صالحة</div>
                <div className="mt-1 text-2xl font-extrabold text-rose-900">{summary.invalid}</div>
              </div>
            </div>

            <div className="mt-5">
              <h3 className="text-lg font-bold text-slate-900">آخر نتائج الرفع</h3>

              <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-right text-slate-700">
                      <th className="px-4 py-3 font-bold">الحالة</th>
                      <th className="px-4 py-3 font-bold">video_id</th>
                      <th className="px-4 py-3 font-bold">الرابط الخام</th>
                      <th className="px-4 py-3 font-bold">الرابط المنظف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                          لا توجد نتائج بعد.
                        </td>
                      </tr>
                    ) : (
                      results
                        .slice()
                        .reverse()
                        .map((row, idx) => (
                          <tr key={`${row.video_id ?? "x"}-${idx}`} className="border-t border-slate-100">
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
                                  row.status === "inserted"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : row.status === "duplicate"
                                    ? "bg-yellow-100 text-yellow-800"
                                    : "bg-rose-100 text-rose-800"
                                }`}
                              >
                                {row.status}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono">{row.video_id ?? "-"}</td>
                            <td className="px-4 py-3 break-all text-slate-700">{row.raw_permalink ?? "-"}</td>
                            <td className="px-4 py-3 break-all text-slate-500">{row.permalink_norm ?? "-"}</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl p-[2px] bg-gradient-to-r from-emerald-600 via-green-500 to-teal-500 shadow-xl shadow-emerald-200/60">
          <div className="bg-white/75 backdrop-blur-xl rounded-3xl p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold text-slate-900">آخر الفيديوهات</h2>
                <p className="mt-1 text-sm text-slate-600">
                  يمكنك تعديل حالة الفيديو وتعطيله دون حذفه.
                </p>
              </div>

              <button
                type="button"
                onClick={() => fetchRecentVideos()}
                disabled={loadingVideos}
                className="rounded-2xl px-5 py-2.5 text-white font-semibold bg-gradient-to-r from-emerald-700 to-teal-600 disabled:opacity-60"
              >
                {loadingVideos ? "جارٍ التحديث..." : "تحديث الجدول"}
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-right text-slate-700">
                    <th className="px-4 py-3 font-bold">ID</th>
                    <th className="px-4 py-3 font-bold">الرابط</th>
                    <th className="px-4 py-3 font-bold">نشط</th>
                    <th className="px-4 py-3 font-bold">الحالة</th>
                    <th className="px-4 py-3 font-bold">سبب الفشل</th>
                    <th className="px-4 py-3 font-bold">آخر فحص</th>
                    <th className="px-4 py-3 font-bold">حفظ</th>
                  </tr>
                </thead>
                <tbody>
                  {recentVideos.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                        لا توجد فيديوهات.
                      </td>
                    </tr>
                  ) : (
                    recentVideos.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100 align-top">
                        <td className="px-4 py-3 font-mono">{row.id}</td>

                        <td className="px-4 py-3 min-w-[360px]">
                          <a
                            href={row.permalink}
                            target="_blank"
                            rel="noreferrer"
                            className="break-all text-emerald-700 hover:underline"
                          >
                            {row.permalink}
                          </a>
                        </td>

                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={row.is_active}
                            onChange={(e) =>
                              handleVideoFieldChange(row.id, "is_active", e.target.checked)
                            }
                          />
                        </td>

                        <td className="px-4 py-3">
                          <select
                            value={row.embed_status}
                            onChange={(e) =>
                              handleVideoFieldChange(row.id, "embed_status", e.target.value)
                            }
                            className="rounded-xl border border-slate-200 px-3 py-2 bg-white"
                          >
                            <option value="unknown">unknown</option>
                            <option value="ok">ok</option>
                            <option value="broken">broken</option>
                            <option value="blocked">blocked</option>
                            <option value="private">private</option>
                            <option value="deleted">deleted</option>
                          </select>
                        </td>

                        <td className="px-4 py-3 min-w-[220px]">
                          <input
                            type="text"
                            value={row.failure_reason ?? ""}
                            onChange={(e) =>
                              handleVideoFieldChange(row.id, "failure_reason", e.target.value)
                            }
                            placeholder="سبب الفشل إن وجد"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 bg-white"
                          />
                        </td>

                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                          {formatDate(row.last_checked_at)}
                        </td>

                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => saveVideoStatus(row)}
                            className="rounded-xl px-4 py-2 text-white font-semibold bg-gradient-to-r from-emerald-700 to-teal-600"
                          >
                            حفظ
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}