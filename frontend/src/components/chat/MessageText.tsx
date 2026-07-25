import { memo, useState } from 'react';
import { translations } from '../../i18n';
import type { Language } from '../../types';

interface MessageTextProps {
  text: string;
  lang: Language;
}

export const MessageText = memo(({ text, lang }: MessageTextProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const t = translations[lang];
  const threshold = 150;
  const isLong = text.length > threshold;

  if (!isLong) return <p className="message-text">{text}</p>;

  return (
    <div className="message-text-container">
      <p className={`message-text ${!isExpanded ? 'truncated' : ''}`}>
        {isExpanded ? text : `${text.substring(0, threshold)}...`}
      </p>
      <button className="read-more-btn" onClick={() => setIsExpanded(!isExpanded)}>
        {isExpanded ? t.readLess : t.readMore}
      </button>
    </div>
  );
});
