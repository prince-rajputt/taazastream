import { expect, test, waitForLibrary } from './fixtures';

test.beforeAll(async ({ request }) => {
  await waitForLibrary(request);
});

test('mobile layout: bottom navigation, rows and details fit the screen', async ({ page }) => {
  await page.goto('/');
  const bottomNav = page.getByRole('navigation', { name: 'Main' }).last();
  await expect(bottomNav).toBeVisible();
  await expect(bottomNav.getByRole('link', { name: 'Movies' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trending Now' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await bottomNav.getByRole('link', { name: 'Movies' }).click();
  await expect(page.getByRole('heading', { name: 'Movies', level: 1 })).toBeVisible();
  await page
    .getByRole('link', { name: /Lantern Coast/ })
    .first()
    .click();
  // "Resume …" when another test already watched part of it.
  await expect(page.getByRole('button', { name: /^(Play|Resume)/ })).toBeVisible();
});
