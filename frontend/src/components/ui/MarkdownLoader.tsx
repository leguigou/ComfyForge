import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

export const MarkdownLoader = ({ url, content: directContent }: { url?: string; content?: string }) => {
  const [content, setContent] = useState(directContent || '');

  useEffect(() => {
    if (url) {
      fetch(url)
        .then(res => res.text())
        .then(setContent)
        .catch(err => console.error('Error loading markdown:', err));
    }
  }, [url]);

  useEffect(() => {
    if (directContent !== undefined) {
      setContent(directContent);
    }
  }, [directContent]);

  return <ReactMarkdown>{content}</ReactMarkdown>;
};
