export interface MedicalDisclaimerBannerProps {
  compact?: boolean;
  className?: string;
}

export function MedicalDisclaimerBanner({ compact = false, className = '' }: MedicalDisclaimerBannerProps) {
  if (compact) {
    return (
      <div
        role="note"
        aria-label="Medical and Dietary Disclaimer"
        className={`rounded border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 ${className}`}
      >
        <span className="font-semibold">Health &amp; Allergen Disclaimer:</span> Nutritional values and recommendations are computational estimates and do not constitute clinical dietary or medical advice. Always verify ingredients on manufacturer packaging if managing severe food allergies or medical conditions.
      </div>
    );
  }

  return (
    <div
      role="note"
      aria-label="Medical and Allergen Safety Notice"
      className={`rounded-lg border border-amber-200 bg-amber-50/80 p-4 md:p-5 text-amber-950 shadow-xs ${className}`}
    >
      <div className="space-y-1 text-xs md:text-sm">
        <h4 className="font-semibold text-amber-900 tracking-tight">
          Important Medical, Dietary &amp; Allergen Notice
        </h4>
        <p className="text-amber-800/90 leading-relaxed text-xs">
          MealMate is an assistive, educational meal-planning platform powered by algorithmic recommender systems and generative models. It is <strong className="font-semibold text-amber-950">not</strong> a licensed medical provider, registered dietitian, or certified medical device.
        </p>
        <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-800">
          <li>Nutritional metrics (calories, macronutrients, sodium) are approximations derived from automated parsing.</li>
          <li>Allergen tags and substitution proposals must be independently verified by checking physical product labels.</li>
          <li>Always consult a qualified physician or board-certified dietitian before starting any significant dietary changes or clinical elimination protocols.</li>
        </ul>
      </div>
    </div>
  );
}
