let csrfToken = '';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const requestUrl = (input: RequestInfo | URL) => {
  if (input instanceof Request) return new URL(input.url, window.location.href);
  return new URL(String(input), window.location.href);
};

export const installCsrfFetchProtection = () => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const url = requestUrl(input);
    const isApiRequest = url.pathname === '/api' || url.pathname.startsWith('/api/');
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));

    if (isApiRequest && !SAFE_METHODS.has(method) && csrfToken) {
      headers.set('X-CSRF-Token', csrfToken);
    }

    const response = await originalFetch(input, { ...init, headers });
    if (isApiRequest) {
      const nextToken = response.headers.get('X-CSRF-Token');
      if (nextToken) csrfToken = nextToken;
    }
    return response;
  };
};
