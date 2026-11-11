import { Link } from 'react-router-dom';
import { MedicalDisclaimerBanner } from '@/components/ui/MedicalDisclaimerBanner';
import { usePageMetadata } from '@/hooks/usePageMetadata';

export function TermsPage() {
  usePageMetadata({
    title: 'Terms of Service | MealMate',
    description:
      'Review the MealMate terms of service governing user accounts, algorithmic meal recommendations, educational research prototypes, and billing policies.',
  });

  const lastUpdated = 'September 28, 2026';

  return (
    <div className="mx-auto max-w-4xl py-6 space-y-10 text-ink">
      {/* Header */}
      <header className="border-b border-line pb-6 space-y-3">
        <p className="mm-eyebrow">Legal Terms &amp; Conditions</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-ink">
          Terms of Service
        </h1>
        <p className="text-sm text-ink-soft">
          Last Updated: <time dateTime="2026-09-28">{lastUpdated}</time> · Version 1.2
        </p>
        <p className="text-sm text-ink-soft leading-relaxed max-w-3xl">
          Welcome to MealMate. Please read these Terms of Service carefully before creating an account or using our meal-planning platform, AI assistant, and recommender services.
        </p>
      </header>

      {/* Prominent Health Disclaimer */}
      <MedicalDisclaimerBanner />

      {/* Sections */}
      <section className="space-y-8 text-sm text-ink-soft leading-relaxed">
        {/* Section 1 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">1. Acceptance of Terms &amp; Age Eligibility</h2>
          <p>
            By accessing or using MealMate (&ldquo;Platform&rdquo;, &ldquo;Service&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), you agree to be bound by these Terms of Service and our <Link to="/privacy" className="text-brand-700 underline font-medium">Privacy Policy</Link>. If you do not agree to all terms, you must immediately discontinue use of the platform.
          </p>
          <div className="rounded-xl border border-line bg-card p-4 text-xs space-y-2">
            <h4 className="font-semibold text-ink uppercase tracking-wider">Age Restriction Notice</h4>
            <p>
              You must be at least <strong className="text-ink">13 years old</strong> (or 16 years old if residing in the European Economic Area or United Kingdom) to create an account. Use by children under 13 is strictly prohibited under our COPPA compliance policies. By registering, you warrant that you satisfy these age requirements.
            </p>
          </div>
        </div>

        {/* Section 2 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">2. High-Risk Advice &amp; Health/Dietary Disclaimers</h2>
          <p className="font-medium text-ink">
            PLEASE READ THIS SECTION CAREFULLY. IT CONTAINS IMPORTANT LIMITATIONS REGARDING MEDICAL AND NUTRITIONAL ADVICE.
          </p>
          <ul className="list-disc pl-5 space-y-2 text-xs">
            <li>
              <strong>Not Medical or Dietetic Care:</strong> MealMate provides automated culinary suggestions based on statistical recommendation algorithms and generative artificial intelligence. The platform is not a medical device, clinic, licensed physician, registered dietitian, or healthcare provider.
            </li>
            <li>
              <strong>No Warranty on Nutritional Data:</strong> Caloric counts, macronutrient ratios, sodium measurements, and glycemic approximations are mathematical estimates derived from public food databases and LLM parsers. Variations in ingredient brands, cooking techniques, and portion sizes will cause differences.
            </li>
            <li>
              <strong>Severe Food Allergies &amp; Cross-Contamination:</strong> While MealMate provides allergy-filtering parameters, we cannot guarantee zero cross-contamination or total accuracy of synthetic recipes. You are exclusively responsible for verifying all physical packaging, ingredients, and allergen warnings before preparing or ingesting food.
            </li>
            <li>
              <strong>Consultation Required:</strong> Always consult your personal physician, allergist, or healthcare professional before making substantial dietary shifts, particularly if you have diabetes, celiac disease, severe food anaphylaxis, renal disease, or cardiovascular concerns.
            </li>
          </ul>
        </div>

        {/* Section 3 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">3. User Accounts &amp; Security</h2>
          <p>
            When registering, you agree to provide accurate, current, and complete registration information. You are responsible for safeguarding your login credentials. You must notify us immediately at <code className="text-xs bg-canvas-soft px-1.5 py-0.5 rounded">security@mealmate.ai</code> if you suspect unauthorized access to your account.
          </p>
        </div>

        {/* Section 4 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">4. Intellectual Property &amp; AI-Generated Content</h2>
          <div className="space-y-3 text-xs">
            <div className="rounded-xl border border-line bg-card p-4 space-y-1">
              <h4 className="font-semibold text-ink">A. User-Generated Content</h4>
              <p>You retain full ownership of any personal notes, original recipes, and fridge photographs you upload. By uploading content, you grant MealMate a non-exclusive, worldwide, royalty-free license solely to host, process, format, and display the content for you within your account.</p>
            </div>
            <div className="rounded-xl border border-line bg-card p-4 space-y-1">
              <h4 className="font-semibold text-ink">B. Platform Property</h4>
              <p>The MealMate interface, design architecture, database schemas, recommender algorithms, logos, codebases, and brand elements are the exclusive intellectual property of MealMate and its licensors, protected by copyright, trademark, and trade secret laws.</p>
            </div>
            <div className="rounded-xl border border-line bg-card p-4 space-y-1">
              <h4 className="font-semibold text-ink">C. AI-Generated Output &amp; IP Rights</h4>
              <p>
                Meal plans, synthetic recipe suggestions, cooking instructions, and chat responses generated by LLMs are provided to you under a personal, non-exclusive license. In accordance with current intellectual property jurisprudence regarding algorithmic generation, MealMate makes no claim of exclusive copyright ownership over raw AI outputs or functional culinary combinations. You acknowledge that AI models may generate identical or similar recipe suggestions for other users.
              </p>
            </div>
          </div>
        </div>

        {/* Section 5 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">5. Permitted &amp; Prohibited Conduct</h2>
          <p>You agree not to use the Service to:</p>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>Engage in automated scraping, mass data harvesting, or reverse-engineering of recommender weights or microservice APIs.</li>
            <li>Submit malicious image payloads, exploit server memory limits, or inject harmful scripts.</li>
            <li>Bypass or circumvent tiered rate-limiting quotas on AI endpoints.</li>
            <li>Promote unscientific, dangerous, or harmful eating disorders or toxic consumption protocols.</li>
          </ul>
        </div>

        {/* Section 6 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">6. Subscriptions, Billing, Cancellation &amp; Refund Policy</h2>
          <p>MealMate provides free research prototype access and optional premium subscription tiers:</p>
          <div className="space-y-2 text-xs">
            <div className="border border-line rounded-xl p-3 bg-card">
              <h4 className="font-semibold text-ink">Cancellation Terms</h4>
              <p className="mt-1">
                You may cancel your subscription at any time through your account settings. Upon cancellation, your subscription remains active until the end of your current paid billing period, with no subsequent recurring charges.
              </p>
            </div>
            <div className="border border-line rounded-xl p-3 bg-card">
              <h4 className="font-semibold text-ink">14-Day Statutory Right of Withdrawal (EU / UK Consumers)</h4>
              <p className="mt-1">
                If you are a consumer in the European Union or United Kingdom, you have the statutory right to withdraw from a purchase within 14 days without giving any reason. To exercise this right, contact <a href="mailto:billing@mealmate.ai" className="text-terracotta hover:underline font-mono bg-canvas-soft px-1 py-0.5 rounded">billing@mealmate.ai</a> within 14 days of subscription inception for a full refund.
              </p>
            </div>
            <div className="border border-line rounded-xl p-3 bg-card">
              <h4 className="font-semibold text-ink">Standard Refund Policy</h4>
              <p className="mt-1">
                Except where required by law, monthly subscription fees are non-refundable once the billing cycle begins. For annual subscriptions, refund requests submitted within 30 calendar days of payment will be granted on a pro-rata basis for unused months.
              </p>
            </div>
          </div>
        </div>

        {/* Section 7 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">7. Disclaimer of Warranties</h2>
          <p className="uppercase text-xs font-semibold text-ink">
            THE PLATFORM IS PROVIDED ON AN &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo; BASIS WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO MERCHANTABILITY, FITNESS FOR A PARTICULAR DIETARY PURPOSE, ACCURACY OF AI RECIPES, OR UNINTERRUPTED AVAILABILITY.
          </p>
        </div>

        {/* Section 8 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">8. Limitation of Liability</h2>
          <p className="text-xs leading-relaxed">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, MEALMATE, ITS DIRECTORS, RESEARCHERS, AND CONTRIBUTORS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO FOOD SPOILAGE, ALLERGIC REACTIONS, HEALTH COMPLICATIONS, LOSS OF DATA, OR SERVICE OUTAGES. OUR TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE GREATER OF ONE HUNDRED US DOLLARS ($100.00 USD) OR THE AMOUNT YOU PAID US IN THE TWELVE MONTHS PRECEDING THE CLAIM.
          </p>
        </div>

        {/* Section 9 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">9. Governing Law &amp; Dispute Resolution</h2>
          <p className="text-xs">
            These Terms shall be governed by the laws of the State of Washington, USA, without regard to conflict of law principles. Any dispute arising under these Terms shall be resolved through binding individual arbitration or small claims court, waiving any right to participate in a class-action lawsuit.
          </p>
        </div>

        {/* Section 10 */}
        <div className="space-y-3">
          <h2 className="font-serif text-2xl font-semibold text-ink">10. Contact Us</h2>
          <p className="text-xs">
            For questions regarding these Terms, contact our legal desk at <a href="mailto:legal@mealmate.ai" className="text-terracotta hover:underline font-mono bg-canvas-soft px-1.5 py-0.5 rounded">legal@mealmate.ai</a> or call our direct project support line at <a href="tel:+12066241688" className="text-terracotta hover:underline font-mono bg-canvas-soft px-1.5 py-0.5 rounded">+1 (206) 624-1688</a>.
          </p>
        </div>
      </section>
    </div>
  );
}
