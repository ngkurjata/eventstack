// app/loading.tsx
export default function Loading() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-white">
      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm p-8">
          <div className="flex items-center gap-4">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
            <div className="font-extrabold text-slate-800">Loading EventStack…</div>
          </div>
          <div className="mt-3 text-sm text-slate-500">
            Pulling the latest teams, artists, and genres.
          </div>
        </div>
      </div>
    </main>
  );
}
