import { expect, test, waitForLibrary } from './fixtures';

test.beforeAll(async ({ request }) => {
  await waitForLibrary(request);
});

test.describe('home page', () => {
  test('shows the hero, rows and branding with no internet', async ({ page, external }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'TaazaStream home' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Play|Resume)$/ }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Trending Now' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recently Added' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Series', exact: true })).toBeVisible();
    expect(external).toEqual([]);
  });
});

test.describe('search', () => {
  test('suggests titles while typing and shows results', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('combobox');
    await box.fill('lant');
    await expect(page.getByRole('option', { name: /Lantern Coast/ })).toBeVisible();
    await box.press('Enter');
    await expect(page).toHaveURL(/\/search\?q=lant/);
    await expect(page.getByRole('link', { name: /Lantern Coast/ }).first()).toBeVisible();
  });

  test('finds titles by cast and genre', async ({ page }) => {
    await page.goto('/search?q=kavya');
    await expect(page.getByRole('link', { name: /Lantern Coast/ }).first()).toBeVisible();
    await page.goto('/search?q=mystery');
    await expect(page.getByRole('link', { name: /Genre: Mystery/ })).toBeVisible();
  });
});

test.describe('movie details', () => {
  test('shows metadata, audio, subtitles and actions', async ({ page }) => {
    await page.goto('/search?q=lantern');
    await page
      .getByRole('link', { name: /Lantern Coast/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Lantern Coast', level: 1 })).toBeVisible();
    await expect(page.getByText('A lighthouse keeper decodes signals')).toBeVisible();
    await expect(page.getByText('8.4').first()).toBeVisible();
    await expect(page.getByText('Subtitles')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
    const myList = page.getByRole('button', { name: /My List/ });
    await myList.click();
    await expect(page.getByRole('button', { name: 'In My List' })).toBeVisible();
    await page.goto('/my-list');
    await expect(page.getByRole('link', { name: /Lantern Coast/ })).toBeVisible();
  });
});

test.describe('video player & continue watching', () => {
  test('plays, seeks, pauses, resumes and appears in Continue Watching', async ({ page }) => {
    await page.goto('/search?q=lantern');
    await page
      .getByRole('link', { name: /Lantern Coast/ })
      .first()
      .click();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page).toHaveURL(/\/watch\//);

    const video = page.locator('video');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 })
      .toBeGreaterThan(1);

    // Seek forward with the keyboard (±10 s) and check the position jumped.
    const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(before + 8);

    // Seek again: positions under 15 s count as "not started" and are not resumed.
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(18);

    // Pause and resume.
    await page.keyboard.press('k');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await page.keyboard.press('k');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);

    // Subtitles toggle with "c".
    await page.keyboard.press('c');
    await expect
      .poll(() =>
        video.evaluate((v: HTMLVideoElement) =>
          [...v.textTracks].some((t) => t.mode === 'showing'),
        ),
      )
      .toBe(true);

    // Leave the player: progress is saved and the title shows up in Continue Watching.
    await page.keyboard.press('k');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.goto('/');
    const row = page.getByRole('region', { name: 'Continue Watching' });
    await expect(row.getByRole('link', { name: /Resume Lantern Coast at/ })).toBeVisible();

    // Opening it again resumes where we stopped.
    await row.getByRole('link', { name: /Resume Lantern Coast/ }).click();
    await expect
      .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime), {
        timeout: 20_000,
      })
      .toBeGreaterThan(14);
    await expect(page.getByText(/Resumed at/)).toBeVisible();
  });

  test('plays a series episode and offers the next one', async ({ page }) => {
    await page.goto('/series');
    await page
      .getByRole('link', { name: /Harbour Lights/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Harbour Lights', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /Episode 2: Storm/ })).toBeVisible();
    await page.getByRole('link', { name: /Episode 1: Arrival/ }).click();
    const video = page.locator('video');
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 })
      .toBeGreaterThan(0.5);
    await video.evaluate((v: HTMLVideoElement) => {
      v.currentTime = v.duration - 6;
    });
    await expect(page.getByText('Next episode')).toBeVisible();
    await page.getByRole('button', { name: /Play (in|now)/ }).click();
    await expect(page.getByText(/S1 E2 · Storm/)).toBeVisible();
  });
});

test.describe('admin dashboard', () => {
  test('requires login and shows server stats', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
    await page.getByLabel('Username').fill('e2eadmin');
    await page.getByLabel('Password').fill('e2e-admin-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Local URL')).toBeVisible();
    await expect(page.getByText('Active streams').first()).toBeVisible();
    await expect(page.getByText('Movies', { exact: true }).first()).toBeVisible();

    await page.getByRole('link', { name: 'Media folders' }).click();
    await expect(page.getByRole('heading', { name: 'Media folders' })).toBeVisible();
    await expect(page.getByText('online')).toBeVisible();

    await page.getByRole('link', { name: 'Library' }).click();
    await page.getByRole('button', { name: /Lantern Coast/ }).click();
    await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      'Lantern Coast',
    );
    await page.getByLabel('Close panel').click();

    await page.getByRole('link', { name: 'Backup & cloud' }).click();
    await expect(page.getByText('local-only').first()).toBeVisible();
  });
});
