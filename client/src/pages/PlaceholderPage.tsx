interface PlaceholderPageProps {
  title: string;
  description?: string;
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
      <p className="mt-2 text-gray-600">
        {description ?? 'This page is coming together in the next phase.'}
      </p>
      <div className="mt-6 rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-ink-soft">
        Coming soon.
      </div>
    </div>
  );
}
