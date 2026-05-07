export default function Layout({ title, children }) {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-bold">{title}</h1>
        {children}
      </div>
    </div>
  )
}
