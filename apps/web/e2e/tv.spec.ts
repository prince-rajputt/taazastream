import { expect, test, waitForLibrary } from './fixtures';

test.beforeAll(async ({ request }) => {
  await waitForLibrary(request);
});

test('Smart TV: larger UI and remote (arrow key) navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/tv/);
  const fontSize = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(20);

  // Focus the hero Play button, then move with the arrow keys like a TV remote.
  await page
    .getByRole('button', { name: /^(Play|Resume)$/ })
    .first()
    .focus();
  await page.keyboard.press('ArrowRight');
  const afterRight = await page.evaluate(() => document.activeElement?.textContent ?? '');
  expect(afterRight).toContain('My List');
  // Moving down eventually reaches a title card link in the first row.
  let tag = '';
  for (let i = 0; i < 4 && tag !== 'A'; i++) {
    await page.keyboard.press('ArrowDown');
    tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  }
  expect(tag).toBe('A');
  await expect(page.locator(':focus-visible')).toHaveCount(1);
});
