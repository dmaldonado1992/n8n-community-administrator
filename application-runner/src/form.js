const captchaSelectors = [
  'iframe[src*="recaptcha"]',
  'iframe[src*="hcaptcha"]',
  '[data-sitekey]',
  '[class*="captcha" i]',
];

const loginPatterns = [/sign in/i, /log in/i, /iniciar sesi[oó]n/i];

async function fillByLabel(page, patterns, value) {
  if (!value) return false;
  for (const pattern of patterns) {
    const field = page.getByLabel(pattern).first();
    if (await field.count()) {
      await field.fill(value);
      return true;
    }
  }
  return false;
}

export async function detectHumanIntervention(page) {
  for (const selector of captchaSelectors) {
    if (await page.locator(selector).count()) return 'captcha';
  }
  const body = await page.locator('body').innerText().catch(() => '');
  if (loginPatterns.some((pattern) => pattern.test(body))) return 'login';
  return null;
}

export async function fillApplicationForm(page, application, resumePdf) {
  const { candidate } = application;
  await fillByLabel(page, [/first name/i, /nombre/i], candidate.firstName);
  await fillByLabel(page, [/last name/i, /apellido/i], candidate.lastName);
  await fillByLabel(page, [/email/i, /correo/i], candidate.email);
  await fillByLabel(page, [/phone/i, /tel[eé]fono/i], candidate.phone);
  await fillByLabel(page, [/city/i, /ciudad/i, /location/i, /ubicaci[oó]n/i], candidate.city);
  await fillByLabel(page, [/linkedin/i], candidate.linkedinUrl);
  await fillByLabel(page, [/website/i, /portfolio/i, /sitio web/i], candidate.websiteUrl);
  await fillByLabel(page, [/cover letter/i, /carta de presentaci[oó]n/i], application.coverLetter);

  const file = page.locator('input[type="file"]').first();
  if (await file.count()) {
    await file.setInputFiles({ name: 'adapted-cv.pdf', mimeType: 'application/pdf', buffer: resumePdf });
  }

  const requiredEmpty = await page.locator('input:required, textarea:required, select:required').evaluateAll((fields) => fields
    .filter((field) => !field.value && field.type !== 'hidden')
    .map((field) => field.getAttribute('name') || field.getAttribute('aria-label') || field.id || 'unknown'));
  return requiredEmpty;
}

export async function clickFirstMatching(page, patterns) {
  for (const pattern of patterns) {
    const button = page.getByRole('button', { name: pattern }).or(page.getByRole('link', { name: pattern })).first();
    if (await button.count()) {
      await button.click();
      return true;
    }
  }
  return false;
}

