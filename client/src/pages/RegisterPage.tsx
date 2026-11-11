import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useRegister } from '@/hooks/useAuth';
import { extractErrorMessage } from '@/lib/api';
import { usePageMetadata } from '@/hooks/usePageMetadata';

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  terms?: string;
  consent?: string;
}

function validate(
  name: string,
  email: string,
  password: string,
  termsAccepted: boolean,
  dietaryConsent: boolean
): FieldErrors {
  const errors: FieldErrors = {};
  if (name.trim().length < 2) errors.name = 'Please enter your full name (at least 2 characters)';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Please enter a valid email address (e.g. name@domain.com)';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters long for security';
  if (!termsAccepted) errors.terms = 'You must confirm you are at least 13 and agree to the Terms of Service & Privacy Policy';
  if (!dietaryConsent) errors.consent = 'Explicit consent is required for MealMate to process dietary and allergy health safety data';
  return errors;
}

export function RegisterPage() {
  usePageMetadata({
    title: 'Create Account | MealMate',
    description:
      'Create your free MealMate account to unlock pantry-aware meal planning, dietary restriction filters, automated grocery deduction, and calm cooking.',
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(true);
  const [dietaryConsent, setDietaryConsent] = useState(true);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [showExplanation, setShowExplanation] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const register = useRegister();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const v = validate(name, email, password, termsAccepted, dietaryConsent);
    setErrors(v);
    if (Object.keys(v).length > 0) return;

    try {
      await register.mutateAsync({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        termsAccepted,
        dietaryConsent,
        marketingOptIn,
      });
      navigate('/recipes', { replace: true });
    } catch (err) {
      setFormError(extractErrorMessage(err, 'Could not create account'));
    }
  }

  return (
    <div className="mx-auto mt-8 w-full max-w-lg">
      <div className="rounded-2xl border border-line bg-card p-8 shadow-soft">
        <div className="flex items-center justify-between">
          <p className="mm-eyebrow">Create your account</p>
          <span className="text-[11px] font-medium text-ink-mute bg-canvas-soft px-2.5 py-0.5 rounded-full border border-line">
            Ages 13+ · 16+ in EEA
          </span>
        </div>
        <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-ink">
          Start eating <span className="italic text-brand-700">thoughtfully</span>
        </h1>
        <p className="mt-2 text-sm text-ink-soft">
          Plan meals, track pantry, and let the assistant draft your week.
        </p>

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4" noValidate>
          <Input
            name="name"
            label="Full name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.name}
            placeholder="Full name"
          />
          <Input
            type="email"
            name="email"
            label="Email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
            placeholder="name@domain.com"
          />
          <Input
            type="password"
            name="password"
            label="Password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            hint="At least 8 characters"
          />

          {/* ──────── Consents & Legal Agreements ──────── */}
          <div className="mt-2 space-y-3 rounded-xl border border-line bg-canvas-soft/60 p-4 text-xs text-ink-soft">
            <div className="space-y-1">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500"
                />
                <span className="text-ink">
                  I confirm I am at least <strong className="font-semibold">13 years of age</strong> (or 16 in the EEA) and agree to the{' '}
                  <Link to="/terms" target="_blank" className="text-brand-700 underline font-semibold">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link to="/privacy" target="_blank" className="text-brand-700 underline font-semibold">
                    Privacy Policy
                  </Link>
                  . <span className="text-red-600">*</span>
                </span>
              </label>
              {errors.terms && <p className="text-[11px] text-red-600 pl-6">{errors.terms}</p>}
            </div>

            <div className="space-y-1">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dietaryConsent}
                  onChange={(e) => setDietaryConsent(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500"
                />
                <span className="text-ink">
                  I give explicit consent for MealMate to process my <strong className="font-semibold">food allergy &amp; dietary preferences</strong> for recipe safety filtering and nutrition approximations (GDPR Art. 9). <span className="text-red-600">*</span>
                </span>
              </label>
              {errors.consent && <p className="text-[11px] text-red-600 pl-6">{errors.consent}</p>}
            </div>

            <div>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={marketingOptIn}
                  onChange={(e) => setMarketingOptIn(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand-600 focus:ring-brand-500"
                />
                <span>
                  (Optional) Send me occasional culinary inspiration, seasonal menus, and product updates.
                </span>
              </label>
            </div>

            {/* Expandable Explanation of What and Why */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowExplanation(!showExplanation)}
                className="text-[11px] text-brand-700 hover:text-brand-800 underline font-medium"
              >
                {showExplanation ? '▼ Hide data collection explanation' : '▶ Why we collect this data & how we protect it'}
              </button>

              {showExplanation && (
                <div className="mt-2 rounded-lg border border-line bg-card p-3 space-y-1 text-[11px] text-ink-mute leading-relaxed animate-in fade-in duration-200">
                  <p><strong className="text-ink">Purpose:</strong> Your food allergies and dietary habits are stored exclusively to exclude allergens and tailor macro estimates.</p>
                  <p><strong className="text-ink">No Sale of Data:</strong> We never sell personal or dietary information to data brokers or advertisers.</p>
                  <p><strong className="text-ink">Full Control:</strong> You can export your data in JSON or delete your entire account with one click anytime in your privacy portal.</p>
                </div>
              )}
            </div>
          </div>

          {formError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {formError}
            </div>
          )}

          <Button type="submit" loading={register.isPending} className="w-full">
            Create account
          </Button>
        </form>

        <p className="mt-7 text-center text-sm text-ink-soft">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-brand-700 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
