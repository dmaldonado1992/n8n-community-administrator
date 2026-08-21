import { buildResumePdf } from './resume.js';
import { clickFirstMatching, detectHumanIntervention, fillApplicationForm } from './form.js';
import { validatePublicJobUrl } from './security.js';

const finalSubmitPatterns = [/submit application/i, /send application/i, /enviar solicitud/i, /enviar postulaci[oó]n/i, /^apply$/i, /^postular$/i];

function liveUrl(session) {
  return session.sessionViewerUrl || session.session_viewer_url || session.debugUrl || null;
}

async function currentPage(browser) {
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  const pages = context.pages();
  return pages[0] || context.newPage();
}

export class ApplicationRunner {
  constructor(provider) {
    this.provider = provider;
  }

  async apply(definition, application) {
    const validatedUrl = await validatePublicJobUrl(application.jobUrl, definition.sourceHosts);
    const session = await this.provider.createSession();
    const browser = await this.provider.connect(session);
    let keepSession = false;
    try {
      const page = await currentPage(browser);
      await page.goto(validatedUrl.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const initialBlock = await detectHumanIntervention(page);
      if (initialBlock) {
        keepSession = true;
        return this.manualResult(application, definition, session, initialBlock);
      }

      await clickFirstMatching(page, definition.applyLabels);
      await page.waitForTimeout(1000);
      const destination = new URL(page.url());
      await validatePublicJobUrl(destination.href, definition.allowedDestinationHosts);

      const block = await detectHumanIntervention(page);
      if (block) {
        keepSession = true;
        return this.manualResult(application, definition, session, block);
      }

      const resumePdf = await buildResumePdf(application.resumeText);
      const requiredEmpty = await fillApplicationForm(page, application, resumePdf);
      if (requiredEmpty.length) {
        keepSession = true;
        return this.manualResult(application, definition, session, 'required_questions', requiredEmpty);
      }
      if (application.dryRun) {
        return { status: 'dry_run_ready', applicationId: application.applicationId, platform: definition.notionName, sessionId: session.id };
      }

      const submitted = await clickFirstMatching(page, finalSubmitPatterns);
      if (!submitted) {
        keepSession = true;
        return this.manualResult(application, definition, session, 'submit_control_not_found');
      }
      await page.waitForTimeout(1500);
      const afterSubmitBlock = await detectHumanIntervention(page);
      if (afterSubmitBlock) {
        keepSession = true;
        return this.manualResult(application, definition, session, afterSubmitBlock);
      }
      return {
        status: 'applied',
        applicationId: application.applicationId,
        platform: definition.notionName,
        evidenceUrl: page.url(),
        submittedAt: new Date().toISOString(),
      };
    } finally {
      await browser.close().catch(() => undefined);
      if (!keepSession) await this.provider.release(session.id).catch(() => undefined);
    }
  }

  async resume(definition, application) {
    const session = await this.provider.getSession(application.sessionId);
    const browser = await this.provider.connect(session);
    let keepSession = false;
    try {
      const page = await currentPage(browser);
      const block = await detectHumanIntervention(page);
      if (block) {
        keepSession = true;
        return this.manualResult(application, definition, session, block);
      }
      const submitted = await clickFirstMatching(page, finalSubmitPatterns);
      if (!submitted) {
        keepSession = true;
        return this.manualResult(application, definition, session, 'submit_control_not_found');
      }
      await page.waitForTimeout(1500);
      return { status: 'applied', applicationId: application.applicationId, platform: definition.notionName, evidenceUrl: page.url(), submittedAt: new Date().toISOString() };
    } finally {
      await browser.close().catch(() => undefined);
      if (!keepSession) await this.provider.release(session.id).catch(() => undefined);
    }
  }

  manualResult(application, definition, session, reason, requiredFields = []) {
    return {
      status: 'manual_required',
      reason,
      requiredFields,
      applicationId: application.applicationId,
      platform: definition.notionName,
      sessionId: session.id,
      controlUrl: liveUrl(session),
    };
  }
}

