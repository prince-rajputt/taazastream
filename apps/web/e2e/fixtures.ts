import { test as base, expect, type APIRequestContext } from '@playwright/test';

/**
 * Every test runs with the "internet" unplugged: any request that is not to the local
 * TaazaStream server is aborted and recorded, and the test fails if one was attempted.
 */
export const test = base.extend<{ external: string[] }>({
  external: async ({ page }, use) => {
    const external: string[] = [];
    await page.route('**/*', (route) => {
      const url = new URL(route.request().url());
      const local =
        ['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.protocol === 'data:' ||
        url.protocol === 'blob:';
      if (local) return route.continue();
      external.push(url.href);
      return route.abort('internetdisconnected');
    });
    await use(external);
    expect(external, 'the app must not contact the internet').toEqual([]);
  },
});

export { expect };

/** Wait until the startup scan has indexed the fixture library. */
export async function waitForLibrary(request: APIRequestContext, minMovies = 2) {
  await expect
    .poll(
      async () => {
        const res = await request.get('/api/movies');
        const body = (await res.json()) as { data: { total: number } };
        return body.data.total;
      },
      { timeout: 90_000, intervals: [500, 1000, 2000] },
    )
    .toBeGreaterThanOrEqual(minMovies);
}
