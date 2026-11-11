import { Link } from 'react-router-dom';
import { openCookiePreferencesModal } from '@/components/ui/CookieConsentBanner';
import { usePageMetadata } from '@/hooks/usePageMetadata';

export function PrivacyPolicyPage() {
  usePageMetadata({
    title: 'Privacy Policy | MealMate',
    description:
      'Learn how MealMate collects, protects, and handles your pantry data, dietary preferences, and account security in compliance with GDPR privacy frameworks.',
  });

  const lastUpdated = 'September 28, 2026';

  return (
    <div className="mx-auto max-w-4xl py-6 space-y-10 text-ink">
      {/* Header */}
      <header className="border-b border-line pb-6 space-y-3">
        <p className="mm-eyebrow">Legal &amp; Privacy Compliance</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-ink">
          Privacy Policy
        </h1>
        <p className="text-sm text-ink-soft">
          Last Updated: <time dateTime="2026-09-28">{lastUpdated}</time> · Version 1.2
        </p>
        <p className="text-sm text-ink-soft leading-relaxed max-w-3xl">
          At MealMate, we believe privacy is a fundamental human right. This Privacy Policy outlines what information we collect, the specific lawful bases and purposes for collecting it, how it is secured, and how you can exercise your statutory rights under the General Data Protection Regulation (GDPR), California Consumer Privacy Act / California Privacy Rights Act (CCPA/CPRA), and the Children's Online Privacy Protection Act (COPPA).
        </p>
      </header>

      {/* Quick Summary Highlights */}
      <section className="rounded-lg border border-line bg-card p-6 space-y-3">
        <h2 className="font-serif text-lg font-semibold text-ink">
          Privacy Highlights at a Glance
        </h2>
        <ul className="grid gap-2 text-xs md:text-sm text-ink-soft">
          <li className="flex items-start gap-2">
            <span><strong>No Sale of Data:</strong> We never sell, rent, or trade your personal or health data to advertisers or third-party data brokers.</span>
          </li>
          <li className="flex items-start gap-2">
            <span><strong>Sensitive Dietary Data:</strong> Your allergy and dietary details are processed exclusively based on your explicit consent to provide safe recipe filtering.</span>
          </li>
          <li className="flex items-start gap-2">
            <span><strong>AI Training Exclusions:</strong> Your private fridge photos and recipes are not used to train public foundation models without permission.</span>
          </li>
          <li className="flex items-start gap-2">
            <span><strong>Self-Service Erasure &amp; Export:</strong> You can download your entire data archive in JSON or permanently delete your account at any time in your <Link to="/privacy/manage" className="underline font-semibold text-brand-700">Privacy Management Dashboard</Link>.</span>
          </li>
        </ul>
      </section>

      {/* Table of Contents */}
      <nav aria-label="Privacy Policy Sections" className="border border-line rounded-xl p-4 bg-card text-xs md:text-sm">
        <h3 className="font-semibold text-ink mb-2">Sections</h3>
        <ol className="grid md:grid-cols-2 gap-1.5 list-decimal pl-5 text-brand-700">
          <li><a href="#controller" className="hover:underline">Data Controller &amp; Contact Information</a></li>
          <li><a href="#data-collected" className="hover:underline">What Personal Data We Collect</a></li>
          <li><a href="#lawful-bases" className="hover:underline">Lawful Bases for Processing (GDPR Art. 6 &amp; 9)</a></li>
          <li><a href="#purposes" className="hover:underline">Why We Collect Data &amp; Purpose Limitation</a></li>
          <li><a href="#subprocessors" className="hover:underline">Third-Party Service Providers &amp; AI Sub-Processors</a></li>
          <li><a href="#retention" className="hover:underline">Data Retention &amp; Automated Deletion</a></li>
          <li><a href="#rights" className="hover:underline">Your Statutory Privacy Rights (GDPR &amp; CCPA)</a></li>
          <li><a href="#children" className="hover:underline">Children's Privacy (COPPA &amp; Age Restriction)</a></li>
          <li><a href="#cookies" className="hover:underline">Cookies &amp; Local Storage Technology</a></li>
          <li><a href="#security" className="hover:underline">Security Measures &amp; International Transfers</a></li>
        </ol>
      </nav>

      {/* Section 1 */}
      <section id="controller" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">1. Data Controller &amp; Contact Information</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          The data controller responsible for your personal information is MealMate (operated for the CS628 research project team at City University of Seattle). For any privacy-related inquiries, Data Protection Officer (DPO) requests, or rights fulfillment, please contact us at:
        </p>
        <div className="rounded-xl border border-line bg-card p-4 text-xs font-mono text-ink space-y-1">
          <div className="font-semibold font-sans">MealMate Privacy Operations</div>
          <div>
            Email:{' '}
            <a href="mailto:privacy@mealmate.ai" className="text-terracotta hover:underline">
              privacy@mealmate.ai
            </a>
          </div>
          <div>
            Data Protection Officer:{' '}
            <a href="mailto:dpo@mealmate.ai" className="text-terracotta hover:underline">
              dpo@mealmate.ai
            </a>
          </div>
          <div>
            Direct Support Line:{' '}
            <a href="tel:+12066241688" className="text-terracotta hover:underline">
              +1 (206) 624-1688
            </a>
          </div>
          <div className="text-ink-mute pt-1">City University of Seattle · CS628 Team T03</div>
        </div>
      </section>

      {/* Section 2 */}
      <section id="data-collected" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">2. What Personal Data We Collect</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          We only collect data that is strictly necessary to provide intelligent, safe, and personalized culinary planning:
        </p>
        <div className="space-y-3 text-sm text-ink-soft">
          <div className="rounded-xl border border-line p-4 bg-card">
            <h3 className="font-semibold text-ink">A. Account &amp; Authentication Identifiers</h3>
            <p className="text-xs mt-1">Full name, email address, cryptographically salted and hashed passwords (via bcrypt), and timestamped consent records.</p>
          </div>
          <div className="rounded-xl border border-line p-4 bg-card">
            <h3 className="font-semibold text-ink">B. Special Category / Sensitive Personal Information (Diet &amp; Allergies)</h3>
            <p className="text-xs mt-1">
              Food allergies (e.g., peanuts, shellfish, gluten, dairy), dietary restrictions (e.g., vegan, halal, kosher, low-sodium), and personal health preferences. Under GDPR Article 9 and CCPA § 1798.140, this constitutes sensitive health/dietary data.
            </p>
          </div>
          <div className="rounded-xl border border-line p-4 bg-card">
            <h3 className="font-semibold text-ink">C. Culinary &amp; Household Data</h3>
            <p className="text-xs mt-1">
              Pantry ingredient lists, grocery lists, scheduled weekly meal plans, user-authored recipes, and temporary fridge photos submitted for vision-based ingredient extraction.
            </p>
          </div>
          <div className="rounded-xl border border-line p-4 bg-card">
            <h3 className="font-semibold text-ink">D. Telemetry &amp; Device Information</h3>
            <p className="text-xs mt-1">
              Browser type, IP address (processed strictly for DDoS protection and tiered rate-limiting), and anonymized request response metrics.
            </p>
          </div>
        </div>
      </section>

      {/* Section 3 */}
      <section id="lawful-bases" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">3. Lawful Bases for Processing (GDPR Articles 6 &amp; 9)</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          In compliance with EU Regulation 2016/679 (GDPR), we process your data under the following legal frameworks:
        </p>
        <ul className="list-disc pl-5 space-y-1.5 text-sm text-ink-soft">
          <li><strong>Contractual Necessity (GDPR Art. 6(1)(b)):</strong> To manage your account, save your recipes, and generate weekly meal schedules.</li>
          <li><strong>Explicit Consent (GDPR Art. 9(2)(a)):</strong> We process your sensitive food allergies and dietary medical needs <em className="font-semibold">only</em> after you give affirmative, unambiguous consent during registration or profile setup.</li>
          <li><strong>Legitimate Interests (GDPR Art. 6(1)(f)):</strong> To secure our web application against brute-force attacks, debug system faults, and prevent abusive bot automation.</li>
          <li><strong>Legal Obligation (GDPR Art. 6(1)(c)):</strong> To comply with applicable tax, accounting, or consumer law requirements.</li>
        </ul>
      </section>

      {/* Section 4 */}
      <section id="purposes" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">4. Why We Collect Data &amp; Purpose Limitation</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Data collected is tied directly to clear consumer utility:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border border-line rounded-lg">
            <thead className="bg-canvas-soft border-b border-line text-ink font-semibold">
              <tr>
                <th className="p-3">Data Element</th>
                <th className="p-3">Exact Purpose</th>
                <th className="p-3">Third-Party Sharing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-ink-soft">
              <tr>
                <td className="p-3 font-medium text-ink">Allergies &amp; Preferences</td>
                <td className="p-3">Filters out dangerous ingredients from recipes and AI meal plans.</td>
                <td className="p-3">Sent strictly to LLM inference provider for prompt grounding; never sold.</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-ink">Pantry Ingredients</td>
                <td className="p-3">Recommends recipes maximizing ingredients on hand to reduce food waste.</td>
                <td className="p-3">None. Handled locally within MealMate infrastructure.</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-ink">Fridge Photos</td>
                <td className="p-3">Extracts ingredient names via computer vision. Immediately discarded after processing.</td>
                <td className="p-3">Processed via Google Gemini / Azure Vision API. Not retained for public training.</td>
              </tr>
              <tr>
                <td className="p-3 font-medium text-ink">Email &amp; Name</td>
                <td className="p-3">Authentication, account recovery, and essential service security alerts.</td>
                <td className="p-3">None.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 5 */}
      <section id="subprocessors" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">5. Third-Party Service Providers &amp; AI Sub-Processors</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          We partner with enterprise cloud providers bound by Data Processing Agreements (DPAs) incorporating standard contractual clauses:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-sm text-ink-soft">
          <li><strong>Database Storage:</strong> MongoDB Atlas (AES-256 encrypted at rest, TLS 1.3 in transit).</li>
          <li><strong>Generative AI &amp; Vision:</strong> Google Gemini API / Azure OpenAI. Prompts containing dietary contexts are processed in enterprise API mode under zero-retention or transient memory agreements and are not used to train global public models.</li>
          <li><strong>Infrastructure:</strong> Docker containerized microservices hosted in secure ISO/IEC 27001 certified data centers.</li>
        </ul>
      </section>

      {/* Section 6 */}
      <section id="retention" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">6. Data Retention &amp; Automated Deletion</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          We retain your personal data only as long as your account remains active. When you delete your account via the <Link to="/privacy/manage" className="text-brand-700 underline font-medium">Privacy Management Dashboard</Link> or send a deletion request to <code className="text-xs bg-canvas-soft px-1.5 py-0.5 rounded">privacy@mealmate.ai</code>, our backend automatically executes a cascade deletion:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-ink-soft">
          <li>Your user account record and authentication credentials are permanently deleted.</li>
          <li>All saved weekly meal plans and scheduled meals are destroyed.</li>
          <li>All grocery lists and ingredient histories are purged.</li>
          <li>All custom recipes authored by your account are permanently removed from the database.</li>
          <li>Transient vision photo uploads are deleted immediately after multimodal parsing (maximum lifetime: 60 seconds).</li>
        </ul>
      </section>

      {/* Section 7 */}
      <section id="rights" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">7. Your Statutory Privacy Rights (GDPR &amp; CCPA/CPRA)</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Regardless of your geographical location, MealMate grants you universal privacy rights:
        </p>
        <div className="grid md:grid-cols-2 gap-3 text-xs text-ink-soft">
          <div className="border border-line rounded-xl p-3 bg-card">
            <h4 className="font-semibold text-ink">Right to Access &amp; Portability</h4>
            <p className="mt-1">Download your full data archive (profile, plans, lists, recipes) in machine-readable JSON format at any time.</p>
          </div>
          <div className="border border-line rounded-xl p-3 bg-card">
            <h4 className="font-semibold text-ink">Right to Erasure (Be Forgotten)</h4>
            <p className="mt-1">Permanently purge your account and all associated culinary data with a single click.</p>
          </div>
          <div className="border border-line rounded-xl p-3 bg-card">
            <h4 className="font-semibold text-ink">Right to Rectification</h4>
            <p className="mt-1">Update incorrect allergies, dietary preferences, or account details directly in your profile settings.</p>
          </div>
          <div className="border border-line rounded-xl p-3 bg-card">
            <h4 className="font-semibold text-ink">Right to Withdraw Consent</h4>
            <p className="mt-1">Revoke processing permissions for health/dietary data or marketing communications whenever you choose.</p>
          </div>
        </div>
        <p className="text-xs text-ink-mute">
          To exercise your rights programmatically, visit our <Link to="/privacy/manage" className="underline text-brand-700">Self-Service Privacy Portal</Link> or email our privacy team.
        </p>
      </section>

      {/* Section 8 */}
      <section id="children" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">8. Children's Privacy (COPPA &amp; Age Restriction)</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          MealMate is strictly intended for individuals aged <strong className="font-semibold text-ink">13 or older</strong> (or 16 in the European Economic Area and United Kingdom). We do not knowingly collect or solicit personal information from children under 13 in compliance with the Children's Online Privacy Protection Act (COPPA). If we learn that we have inadvertently collected personal data from a child under the required age, we will immediately delete that information. Parents or guardians who believe their child has registered can contact us at <a href="mailto:privacy@mealmate.ai" className="text-terracotta hover:underline font-mono text-xs bg-canvas-soft px-1.5 py-0.5 rounded">privacy@mealmate.ai</a>.
        </p>
      </section>

      {/* Section 9 */}
      <section id="cookies" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">9. Cookies &amp; Local Storage Technology</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          MealMate uses HTML5 browser Local Storage rather than intrusive third-party cross-site advertising cookies:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-ink-soft">
          <li><strong>Strictly Necessary Storage:</strong> Secure JWT authentication token (`mealmate_token`) and user session state (`auth-storage`). Essential for logging you in and routing protected requests.</li>
          <li><strong>Consent State:</strong> Stores your cookie and storage preferences (`mealmate_cookie_consent`).</li>
          <li><strong>Performance Telemetry:</strong> Anonymized response benchmarks to measure microservice latency.</li>
        </ul>
        <div className="pt-2">
          <button
            type="button"
            onClick={openCookiePreferencesModal}
            className="text-xs font-semibold text-brand-700 hover:text-brand-800 underline"
          >
            Click here to open or edit your Cookie &amp; Storage Preferences
          </button>
        </div>
      </section>

      {/* Section 10 */}
      <section id="security" className="space-y-3">
        <h2 className="font-serif text-2xl font-semibold text-ink">10. Security Measures &amp; Supervisory Authorities</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          We apply defense-in-depth security principles: HTTP Strict Transport Security (HSTS), Content Security Policy (CSP), parameterized database queries preventing NoSQL injection, bcrypt salted hashing, rate-limiting on sensitive endpoints, and encrypted transport via TLS 1.3.
        </p>
        <p className="text-sm text-ink-soft leading-relaxed">
          If you are an EU/EEA resident and believe our data processing violates your rights, you have the statutory right to lodge a complaint with your local National Data Protection Supervisory Authority (e.g. the CNIL in France, BfDI in Germany, or DPC in Ireland).
        </p>
      </section>
    </div>
  );
}
