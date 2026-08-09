import { useEffect, useState } from 'react';
import { translations } from '../../i18n';
import type { Language } from '../../types';
import { CameraIcon, ComposeIcon, DiceIcon, HeartIcon, MagicWandIcon, RefreshIcon, SparklesIcon, StarIcon } from '../ui/Icons';

export type WelcomeSuggestionAction =
  | 'surprise'
  | 'image'
  | 'favorite'
  | 'imagine'
  | 'remix'
  | 'portrait'
  | 'cinematic'
  | 'resume';

const WELCOME_SUGGESTIONS: WelcomeSuggestionAction[] = [
  'surprise',
  'image',
  'favorite',
  'imagine',
  'remix',
  'portrait',
  'cinematic',
  'resume',
];

const VISIBLE_SUGGESTION_COUNT = 3;
const SUGGESTION_ROTATION_MS = 12_000;

interface WelcomeScreenProps {
  lang: Language;
  onSelectSuggestion?: (suggestion: WelcomeSuggestionAction) => void;
}

const SuggestionIcon = ({ suggestion }: { suggestion: WelcomeSuggestionAction }) => {
  if (suggestion === 'surprise') return <DiceIcon size={23} />;
  if (suggestion === 'image') return <CameraIcon size={23} />;
  if (suggestion === 'favorite') return <HeartIcon size={23} filled />;
  if (suggestion === 'imagine') return <SparklesIcon size={23} />;
  if (suggestion === 'remix') return <MagicWandIcon size={23} />;
  if (suggestion === 'portrait') return <StarIcon size={23} />;
  if (suggestion === 'cinematic') return <ComposeIcon size={23} />;
  return <RefreshIcon size={23} />;
};

export const WelcomeScreen = ({ lang, onSelectSuggestion }: WelcomeScreenProps) => {
  const t = translations[lang];
  const [rotationStart, setRotationStart] = useState(0);
  const [rotationPaused, setRotationPaused] = useState(false);
  const suggestionLabels: Record<WelcomeSuggestionAction, string> = {
    surprise: t.welcomeSurprise,
    image: t.welcomeImage,
    favorite: t.welcomeFavorite,
    imagine: t.welcomeImagine,
    remix: t.welcomeRemix,
    portrait: t.welcomePortrait,
    cinematic: t.welcomeCinematic,
    resume: t.welcomeResume,
  };
  const visibleSuggestions = Array.from({ length: VISIBLE_SUGGESTION_COUNT }, (_, index) => (
    WELCOME_SUGGESTIONS[(rotationStart + index) % WELCOME_SUGGESTIONS.length]
  ));

  useEffect(() => {
    if (rotationPaused) return;
    const interval = window.setInterval(() => {
      setRotationStart(current => (current + VISIBLE_SUGGESTION_COUNT) % WELCOME_SUGGESTIONS.length);
    }, SUGGESTION_ROTATION_MS);
    return () => window.clearInterval(interval);
  }, [rotationPaused]);

  const rotateSuggestions = () => {
    setRotationStart(current => (current + VISIBLE_SUGGESTION_COUNT) % WELCOME_SUGGESTIONS.length);
  };

  return (
    <div className="welcome-screen">
      <div className="welcome-icon">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 0C12 0 12.6315 5.63158 15.4358 8.43579C18.24 11.24 24 12 24 12C24 12 18.24 12.76 15.4358 15.5642C12.6315 18.3684 12 24 12 24C12 24 11.3684 18.3684 8.56421 15.5642C5.76 12.76 0 12 0 12C0 12 5.76 11.24 8.56421 8.43579C11.3684 5.63158 12 0 12 0Z" fill="url(#gemini-gradient)"/>
          <defs>
            <linearGradient id="gemini-gradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
              <stop stopColor="#4285F4"/>
              <stop offset="0.33" stopColor="#EA4335"/>
              <stop offset="0.66" stopColor="#FBBC05"/>
              <stop offset="1" stopColor="#34A853"/>
            </linearGradient>
          </defs>
        </svg>
      </div>
      <h1>{t.welcomeText}</h1>
      <div
        className="welcome-suggestions-shell"
        onMouseEnter={() => setRotationPaused(true)}
        onMouseLeave={() => setRotationPaused(false)}
        onFocusCapture={() => setRotationPaused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setRotationPaused(false);
        }}
      >
        <button
          type="button"
          className="welcome-suggestions-refresh"
          onClick={rotateSuggestions}
          aria-label={t.welcomeRotateSuggestions}
          title={t.welcomeRotateSuggestions}
        >
          <RefreshIcon size={15} />
        </button>
        <div key={rotationStart} className="welcome-suggestions" aria-label={t.welcomeSuggestionsLabel}>
          {visibleSuggestions.map(suggestion => (
            <button
              type="button"
              className="welcome-suggestion"
              data-suggestion={suggestion}
              key={suggestion}
              onClick={() => onSelectSuggestion?.(suggestion)}
            >
              <span className="welcome-suggestion-icon" aria-hidden="true">
                <SuggestionIcon suggestion={suggestion} />
              </span>
              <span>{suggestionLabels[suggestion]}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
