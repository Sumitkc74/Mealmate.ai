import { useState, useEffect, useRef } from 'react';
import type { Recipe } from '@/types';
import { Button } from '@/components/ui/Button';

interface KitchenModeModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipe: Recipe;
}

export function KitchenModeModal({ isOpen, onClose, recipe }: KitchenModeModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [voiceActive, setVoiceActive] = useState(false);
  const [lastTranscript, setLastTranscript] = useState('');
  const [showIngredients, setShowIngredients] = useState(false);

  // Kitchen Timer state
  const [timerSeconds, setTimerSeconds] = useState<number | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);

  const recognitionRef = useRef<any>(null);
  const timerIntervalRef = useRef<any>(null);

  const totalSteps = recipe.instructions.length;
  const currentInstruction = recipe.instructions[currentStep] || '';
  const progressPct = totalSteps > 0 ? Math.round(((currentStep + 1) / totalSteps) * 100) : 0;

  // Web Audio chime for timer finish
  function playTimerChime() {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } catch {
      // AudioContext unavailable or restricted
    }
  }

  // Timer countdown loop
  useEffect(() => {
    if (timerRunning && timerSeconds !== null && timerSeconds > 0) {
      timerIntervalRef.current = setInterval(() => {
        setTimerSeconds((prev) => {
          if (prev !== null && prev <= 1) {
            clearInterval(timerIntervalRef.current);
            setTimerRunning(false);
            playTimerChime();
            return 0;
          }
          return prev !== null ? prev - 1 : null;
        });
      }, 1000);
    }
    return () => clearInterval(timerIntervalRef.current);
  }, [timerRunning, timerSeconds]);

  // Read current step aloud using SpeechSynthesis
  function speakCurrentStep(text?: string) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text || currentInstruction);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }

  // Handle Speech Recognition for hands-free commands
  useEffect(() => {
    if (!isOpen || !voiceActive) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
      }
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setLastTranscript('Voice recognition is not supported in this browser.');
      setVoiceActive(false);
      return;
    }

    const rec = new SpeechRecognition();
    recognitionRef.current = rec;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';

    rec.onresult = (event: any) => {
      const last = event.results[event.results.length - 1];
      const text = last[0]?.transcript?.trim().toLowerCase() || '';
      setLastTranscript(text);

      if (text.includes('next') || text.includes('forward')) {
        setCurrentStep((prev) => {
          const next = Math.min(prev + 1, totalSteps - 1);
          speakCurrentStep(recipe.instructions[next]);
          return next;
        });
      } else if (text.includes('back') || text.includes('previous')) {
        setCurrentStep((prev) => {
          const back = Math.max(prev - 1, 0);
          speakCurrentStep(recipe.instructions[back]);
          return back;
        });
      } else if (text.includes('read') || text.includes('repeat')) {
        speakCurrentStep();
      } else if (text.includes('timer')) {
        const match = text.match(/(\d+)\s*(minute|min|second|sec)/);
        if (match) {
          const num = parseInt(match[1], 10);
          const isSec = match[2].startsWith('sec');
          const secs = isSec ? num : num * 60;
          setTimerSeconds(secs);
          setTimerRunning(true);
          speakCurrentStep(`Timer set for ${num} ${match[2]}`);
        }
      } else if (text.includes('stop') || text.includes('pause')) {
        setTimerRunning(false);
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      } else if (text.includes('exit') || text.includes('close')) {
        onClose();
      }
    };

    rec.onerror = () => {
      // Automatic restart if aborted
    };

    rec.onend = () => {
      if (voiceActive) {
        try {
          rec.start();
        } catch {}
      }
    };

    try {
      rec.start();
    } catch {}

    return () => {
      try {
        rec.stop();
      } catch {}
    };
  }, [isOpen, voiceActive, totalSteps, recipe.instructions, currentInstruction, onClose]);

  // Stop audio on unmount or close
  useEffect(() => {
    if (!isOpen) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setVoiceActive(false);
      setCurrentStep(0);
      setTimerSeconds(null);
      setTimerRunning(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const timerMins = timerSeconds !== null ? Math.floor(timerSeconds / 60) : 0;
  const timerSecs = timerSeconds !== null ? timerSeconds % 60 : 0;
  const formattedTimer = `${timerMins}:${timerSecs < 10 ? '0' : ''}${timerSecs}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Kitchen Cooking Mode"
      className="fixed inset-0 z-50 flex flex-col bg-gray-950 text-white animate-fadeIn"
    >
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between border-b border-gray-800 bg-gray-900 px-6 py-4">
        <div className="flex items-center gap-3">
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">{recipe.title}</h2>
            <p className="text-xs text-gray-400">
              Step {currentStep + 1} of {totalSteps} ({progressPct}% done)
            </p>
          </div>
        </div>

        {/* Center / Timer Widget */}
        <div className="flex items-center gap-3">
          {timerSeconds !== null ? (
            <div className="flex items-center gap-2 rounded bg-gray-800 px-3 py-1.5 border border-gray-700">
              <span className={`text-sm font-mono font-bold ${timerSeconds === 0 ? 'text-red-400' : 'text-amber-400'}`}>
                Timer: {formattedTimer}
              </span>
              <button
                type="button"
                onClick={() => setTimerRunning(!timerRunning)}
                className="text-xs font-semibold px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
              >
                {timerRunning ? 'Pause' : 'Start'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimerSeconds(null);
                  setTimerRunning(false);
                }}
                className="text-xs text-gray-400 hover:text-white px-1"
                aria-label="Reset timer"
              >
                Reset
              </button>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
              <span>Quick timer:</span>
              {[1, 3, 5, 10].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setTimerSeconds(m * 60);
                    setTimerRunning(true);
                  }}
                  className="rounded bg-gray-800 px-2 py-1 font-mono text-gray-300 hover:bg-gray-700 border border-gray-700"
                >
                  +{m}m
                </button>
              ))}
            </div>
          )}

          {/* Voice Command Toggle */}
          <button
            type="button"
            onClick={() => setVoiceActive(!voiceActive)}
            className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition border ${
              voiceActive
                ? 'bg-red-950/80 border-red-600 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.3)]'
                : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
            }`}
            title="Toggle hands-free speech control"
          >
            <span className={`h-2.5 w-2.5 rounded-full ${voiceActive ? 'bg-red-500 animate-ping' : 'bg-gray-500'}`} />
            <span>{voiceActive ? 'Voice Listening' : 'Enable Voice'}</span>
          </button>

          {/* Close Kitchen Mode */}
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700"
            aria-label="Exit Kitchen Mode"
          >
            Exit
          </button>
        </div>
      </header>

      {/* Progress Bar */}
      <div className="h-1.5 w-full bg-gray-800">
        <div
          className="h-full bg-emerald-500 transition-all duration-300"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col justify-center items-center px-6 sm:px-12 py-8 max-w-5xl mx-auto w-full text-center">
        {/* Step Badge */}
        <div className="mb-4 inline-flex items-center gap-2 rounded bg-gray-900 border border-gray-800 px-3 py-1 text-xs font-mono font-semibold text-gray-300">
          <span>STEP {currentStep + 1} OF {totalSteps}</span>
        </div>

        {/* Large Readable Instruction */}
        <div className="min-h-[160px] flex items-center justify-center">
          <p className="text-2xl sm:text-4xl font-medium leading-relaxed sm:leading-loose text-gray-100 max-w-3xl">
            {currentInstruction}
          </p>
        </div>

        {/* Voice Feedback Badge */}
        {voiceActive && (
          <div className="mt-6 flex flex-col items-center gap-1.5 text-xs text-gray-400">
            <div className="flex items-center gap-2 rounded bg-gray-900 border border-gray-800 px-3 py-1 font-mono">
              <span className="text-gray-300">Commands:</span>
              <span>"Next", "Back", "Read step", "Timer 5 min", "Exit"</span>
            </div>
            {lastTranscript && (
              <span className="text-gray-500 italic">Heard: "{lastTranscript}"</span>
            )}
          </div>
        )}
      </main>

      {/* Ingredients Drawer (Collapsible) */}
      {showIngredients && (
        <aside className="border-t border-gray-800 bg-gray-900 p-6 max-h-64 overflow-y-auto">
          <div className="max-w-4xl mx-auto">
            <h4 className="text-xs font-mono uppercase tracking-wider text-gray-400 mb-3">
              Recipe Ingredients
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
              {recipe.ingredients.map((ing, i) => (
                <div key={i} className="flex items-center gap-1.5 bg-gray-800/80 rounded p-2 border border-gray-700/60">
                  <span className="text-gray-400 font-mono">•</span>
                  <span className="font-medium text-gray-200">{ing.name}</span>
                  {ing.quantity && (
                    <span className="text-xs text-gray-400">
                      ({ing.quantity} {ing.unit || ''})
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>
      )}

      {/* Bottom Sticky Action Bar */}
      <footer className="border-t border-gray-800 bg-gray-900 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4 max-w-5xl mx-auto w-full">
          <button
            type="button"
            onClick={() => setShowIngredients(!showIngredients)}
            className="flex items-center gap-2 rounded bg-gray-800 hover:bg-gray-700 px-4 py-2.5 text-xs font-semibold text-gray-300 border border-gray-700 transition"
          >
            <span>{showIngredients ? 'Hide Ingredients' : 'View Ingredients'}</span>
          </button>

          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              disabled={currentStep === 0}
              onClick={() => {
                const back = Math.max(currentStep - 1, 0);
                setCurrentStep(back);
                speakCurrentStep(recipe.instructions[back]);
              }}
              className="text-sm px-5 py-2.5"
            >
              Previous
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={() => speakCurrentStep()}
              title="Read instruction aloud"
              className="text-sm px-4 py-2.5"
            >
              Read Aloud
            </Button>

            <Button
              type="button"
              size="lg"
              disabled={currentStep === totalSteps - 1}
              onClick={() => {
                const next = Math.min(currentStep + 1, totalSteps - 1);
                setCurrentStep(next);
                speakCurrentStep(recipe.instructions[next]);
              }}
              className="text-sm px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 font-bold"
            >
              Next Step
            </Button>
          </div>
        </div>
      </footer>
    </div>
  );
}

