import { useEffect } from 'react';

interface PageMetadataOptions {
  title?: string;
  description?: string;
}

export function usePageMetadata({ title, description }: PageMetadataOptions) {
  useEffect(() => {
    if (title) {
      document.title = title;
    }
    if (description) {
      let meta = document.querySelector('meta[name="description"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'description');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', description);
    }
  }, [title, description]);
}

