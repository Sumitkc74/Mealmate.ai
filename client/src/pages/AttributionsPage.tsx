import { usePageMetadata } from '@/hooks/usePageMetadata';

export function AttributionsPage() {
  usePageMetadata({
    title: 'Licenses & Attributions | MealMate',
    description:
      'Review open-source licenses, software packages, icon sets, and culinary datasets powering the MealMate meal planning application and research prototypes.',
  });

  const dependencies = [
    { name: 'React & React DOM', license: 'MIT', url: 'https://react.dev', purpose: 'User interface framework' },
    { name: 'React Router', license: 'MIT', url: 'https://reactrouter.com', purpose: 'Client-side routing' },
    { name: 'FastAPI', license: 'MIT', url: 'https://fastapi.tiangolo.com', purpose: 'Asynchronous Python microservice framework' },
    { name: 'Scikit-learn', license: 'BSD 3-Clause', url: 'https://scikit-learn.org', purpose: 'TF-IDF & LSA vector space algorithms for recipe retrieval' },
    { name: 'Tailwind CSS', license: 'MIT', url: 'https://tailwindcss.com', purpose: 'Utility-first styling system' },
    { name: 'Express', license: 'MIT', url: 'https://expressjs.com', purpose: 'Node.js backend API framework' },
    { name: 'Mongoose', license: 'MIT', url: 'https://mongoosejs.com', purpose: 'MongoDB object modeling' },
    { name: 'Zustand', license: 'MIT', url: 'https://github.com/pmndrs/zustand', purpose: 'Client state management' },
    { name: 'TanStack Query', license: 'MIT', url: 'https://tanstack.com/query', purpose: 'Server state caching and synchronization' },
    { name: 'Axios', license: 'MIT', url: 'https://axios-http.com', purpose: 'HTTP client for API calls' },
    { name: 'Socket.IO', license: 'MIT', url: 'https://socket.io', purpose: 'Real-time client/server messaging' },
    { name: 'Google Generative AI SDK', license: 'Apache 2.0', url: 'https://ai.google.dev', purpose: 'Gemini model client for the AI service' },
    { name: 'Recharts', license: 'MIT', url: 'https://recharts.org', purpose: 'Nutritional analytics visualizations' },
    { name: 'jsPDF', license: 'MIT', url: 'https://github.com/parallax/jsPDF', purpose: 'Client-side PDF generation for grocery lists' },
    { name: 'SheetJS (xlsx)', license: 'Apache 2.0', url: 'https://sheetjs.com', purpose: 'Spreadsheet export of grocery lists' },
    { name: 'React DnD', license: 'BSD 3-Clause', url: 'https://react-dnd.github.io/react-dnd', purpose: 'Drag-and-drop meal planning grid' },
    { name: 'Framer Motion', license: 'MIT', url: 'https://www.framer.com/motion', purpose: 'UI animations and transitions' },
    { name: 'React Markdown', license: 'MIT', url: 'https://github.com/remarkjs/react-markdown', purpose: 'Rendering AI chat markdown' },
    { name: 'bcryptjs', license: 'MIT', url: 'https://github.com/dcodeIO/bcrypt.js', purpose: 'Password hashing' },
    { name: 'JSON Web Token', license: 'MIT', url: 'https://github.com/auth0/node-jsonwebtoken', purpose: 'Signed session tokens' },
    { name: 'Zod', license: 'MIT', url: 'https://zod.dev', purpose: 'Request validation schemas' },
    { name: 'Helmet', license: 'MIT', url: 'https://helmetjs.github.io', purpose: 'HTTP security headers' },
    { name: 'Pino & Morgan', license: 'MIT', url: 'https://getpino.io', purpose: 'Structured application logging' },
    { name: 'Prometheus Client', license: 'Apache 2.0', url: 'https://prometheus.io', purpose: 'Telemetry and operational metrics' },
    { name: 'Vite', license: 'MIT', url: 'https://vite.dev', purpose: 'Frontend build tool and dev server' },
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

      {/* Recipe Imagery */}
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">Recipe Imagery</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Recipe photos come from three sources, and each photo carries its attribution where it is shown:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm text-ink-soft">
          <li>
            <strong>Wikimedia Commons</strong> — real dish photographs, licensed under{' '}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">Creative Commons Attribution-ShareAlike (CC BY-SA)</a>.
            These photos require attribution, which is shown with the photo and links back to{' '}
            <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">Wikimedia Commons</a>.
          </li>
          <li>
            <strong>Pollinations.AI</strong> — AI-generated images used when no suitable photograph is found. Generated by{' '}
            <a href="https://pollinations.ai" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">Pollinations.AI</a>;
            model licences vary, so verify before commercial use.
          </li>
          <li>
            <strong>User-provided URLs</strong> — images pasted by the recipe author. The author is responsible for having the right to use them; MealMate does not check their licence.
          </li>
        </ul>
        <p className="text-sm text-ink-soft leading-relaxed">
          MealMate caches remote photos on its own server for faster loading. Caching does not change who owns the image or its licence.
        </p>
      </section>

      {/* Third-party services (not open source) */}
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">Third-Party Services</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          These are hosted services MealMate relies on, not open-source packages: MongoDB Atlas (database), Vercel (web hosting), Render (API and AI-service hosting), Google Gemini API (AI features, free tier), and Resend (account emails). Their terms govern their use.
        </p>
      </section>

      {/* License texts */}
      <section className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">Full License Texts</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          The MIT, BSD 3-Clause, and Apache 2.0 licences above are reproduced in full at their canonical sources:{' '}
          <a href="https://opensource.org/licenses/MIT" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">MIT</a>,{' '}
          <a href="https://opensource.org/licenses/BSD-3-Clause" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">BSD 3-Clause</a>,{' '}
          <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">Apache 2.0</a>, and the{' '}
          <a href="https://scripts.sil.org/OFL" target="_blank" rel="noreferrer" className="text-brand-700 underline font-medium">SIL Open Font License 1.1</a>.
        </p>
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
