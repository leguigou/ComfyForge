import { translations } from '../../i18n';
import type { Language } from '../../types';

interface WelcomeScreenProps {
  lang: Language;
}

export const WelcomeScreen = ({ lang }: WelcomeScreenProps) => {
  const t = translations[lang];
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
    </div>
  );
};
