// Production build: the API is served from the same server as the app (copy dist into the API's wwwroot),
// or behind a reverse proxy at /api.
export const environment = {
  production: true,
  apiUrl: '/api',
};
