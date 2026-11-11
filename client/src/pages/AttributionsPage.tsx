import { usePageMetadata } from '@/hooks/usePageMetadata';

export function AttributionsPage() {
  usePageMetadata({
    title: 'Licenses & Attributions | MealMate',
    description:
      'Review open-source licenses, software packages, icon sets, and culinary datasets powering the MealMate meal planning application and research prototypes.',
  });

  const dependencies = [
    { name: 'React & React DOM', license: 'MIT', url: 'https://react.dev', purpose: 'User interface framework' },
    { name: 'FastAPI', license: 'MIT', url: 'https://fastapi.tiangolo.com', purpose: 'Asynchronous Python microservice framework' },
    { name: 'Scikit-learn', license: 'BSD 3-Clause', url: 'https://scikit-learn.org', purpose: 'TF-IDF & LSA vector space algorithms' },
    { name: 'Tailwind CSS', license: 'MIT', url: 'https://tailwindcss.com', purpose: 'Utility-first styling system' },
    { name: 'Express', license: 'MIT', url: 'https://expressjs.com', purpose: 'Node.js backend API framework' },
    { name: 'Mongoose', license: 'MIT', url: 'https://mongoosejs.com', purpose: 'MongoDB object modeling' },
    { name: 'Zustand', license: 'MIT', url: 'https://github.com/pmndrs/zustand', purpose: 'Client state management' },
    { name: 'TanStack Query', license: 'MIT', url: 'https://tanstack.com/query', purpose: 'Server state caching and synchronization' },
    { name: 'Recharts', license: 'MIT', url: 'https://recharts.org', purpose: 'Nutritional analytics visualizations' },
    { name: 'jsPDF', license: 'MIT', url: 'https://github.com/parallax/jsPDF', purpose: 'Client-side PDF generation for grocery lists' },
    { name: 'React DnD', license: 'BSD 3-Clause', url: 'https://react-dnd.github.io/react-dnd', purpose: 'Drag-and-drop meal planning grid' },
    { name: 'ChromaDB', license: 'Apache 2.0', url: 'https://www.trychroma.com', purpose: 'Embedded vector database for RAG culinary lookup' },
    { name: 'Sentence Transformers', license: 'Apache 2.0', url: 'https://sbert.net', purpose: 'All-MiniLM semantic text embeddings' },
    { name: 'Pino & Morgan', license: 'MIT', url: 'https://getpino.io', purpose: 'Structured application logging' },
    { name: 'Prometheus Client', license: 'Apache 2.0', url: 'https://prometheus.io', purpose: 'Telemetry and operational metrics' },
  ];

  return (
    <div className="mx-auto max-w-4xl py-6 space-y-10 text-ink">
      <header className="border-b border-line pb-6 space-y-3">
        <p className="mm-eyebrow">Open Source Credits &amp; Attribution</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-ink">
          Third-Party Licenses &amp; Attributions
        </h1>
        <p className="text-sm text-ink-soft leading-relaxed max-w-3xl">
          MealMate is built with gratitude upon outstanding open-source libraries, standards, and typographic craftsmanship. This page provides full attribution and copyright acknowledgments in compliance with their respective licenses.
        </p>
      </header>

      {/* Typography and Design Assets */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-ink">Typography &amp; UI Assets</h2>
        <div className="grid md:grid-cols-2 gap-4 text-xs text-ink-soft">
          <div className="border border-line rounded-xl p-4 bg-card space-y-1">
            <h3 className="font-semibold text-ink text-sm">Newsreader</h3>
            <p className="text-ink-mute">Editorial Serif Typeface by Production Type</p>
            <p className="text-[11px]">Licensed under the <a href="https://scripts.sil.org/OFL" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">SIL Open Font License, Version 1.1</a>.</p>
          </div>
          <div className="border border-line rounded-xl p-4 bg-card space-y-1">
            <h3 className="font-semibold text-ink text-sm">Inter</h3>
            <p className="text-ink-mute">Interface Sans-Serif Font Family by Rasmus Andersson</p>
            <p className="text-[11px]">Licensed under the <a href="https://scripts.sil.org/OFL" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">SIL Open Font License, Version 1.1</a>.</p>
          </div>
        </div>
      </section>

      {/* Dependency Licenses Table */}
      <section className="space-y-4">
        <h2 className="font-serif text-2xl font-semibold text-ink">Open Source Software Dependencies</h2>
        <div className="overflow-x-auto border border-line rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-canvas-soft border-b border-line text-ink font-semibold">
              <tr>
                <th className="p-3">Package / Software</th>
                <th className="p-3">License</th>
                <th className="p-3">Role in System</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-soft">
              {dependencies.map((dep) => (
                <tr key={dep.name} className="hover:bg-canvas-soft/50">
                  <td className="p-3 font-medium text-ink">
                    <a href={dep.url} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">
                      {dep.name} ↗
                    </a>
                  </td>
                  <td className="p-3">
                    <span className="inline-block px-2 py-0.5 rounded-full bg-card border border-line text-[11px] font-mono text-ink">
                      {dep.license}
                    </span>
                  </td>
                  <td className="p-3">{dep.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Dataset & Culinary Knowledge Notice */}
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">Culinary Datasets &amp; Recipe Knowledge</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          The seed recipe collection, ingredient graph linkages, and sustainability carbon coefficients are composed of public domain factual culinary data, USDA FoodData Central open nutritional metrics, and educational knowledge graphs created for the CS628 research prototype. Bare ingredient lists and mechanical cooking instructions are utilized in harmony with US and international copyright guidelines.
        </p>
      </section>
    </div>
  );
}
