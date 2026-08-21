const atsHosts = [
  'boards.greenhouse.io',
  'job-boards.greenhouse.io',
  'jobs.lever.co',
  'jobs.eu.lever.co',
  'jobs.ashbyhq.com',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'icims.com',
  'bamboohr.com',
  'recruitee.com',
];

const configurations = [
  ['linkedin', 'LinkedIn', ['linkedin.com'], [/easy apply/i, /apply/i]],
  ['indeed', 'Indeed', ['indeed.com'], [/apply now/i, /apply/i]],
  ['ziprecruiter', 'ZipRecruiter', ['ziprecruiter.com'], [/1-click apply/i, /apply/i]],
  ['remote-com', 'Remote.com', ['remote.com'], [/apply/i]],
  ['we-work-remotely', 'We Work Remotely', ['weworkremotely.com'], [/apply for this position/i, /apply/i]],
  ['remote-ok', 'Remote OK', ['remoteok.com'], [/apply/i]],
  ['remotive', 'Remotive', ['remotive.com'], [/apply/i]],
  ['working-nomads', 'Working Nomads', ['workingnomads.com'], [/apply/i]],
  ['jobspresso', 'Jobspresso', ['jobspresso.co'], [/apply/i]],
  ['glassdoor', 'Glassdoor', ['glassdoor.com'], [/easy apply/i, /apply/i]],
  ['wellfound', 'Wellfound', ['wellfound.com'], [/apply/i]],
  ['dice', 'Dice', ['dice.com'], [/easy apply/i, /apply/i]],
  ['torre', 'Torre', ['torre.ai', 'torre.co'], [/apply/i, /aplicar/i]],
  ['get-on-board', 'Get on Board', ['getonbrd.com'], [/apply/i, /postular/i]],
  ['computrabajo', 'Computrabajo', ['computrabajo.com'], [/postularme/i, /aplicar/i]],
  ['tecoloco', 'Tecoloco', ['tecoloco.com'], [/aplicar/i, /postular/i]],
  ['empresa-directa', 'Empresa directa', atsHosts, [/apply/i, /submit application/i, /postular/i]],
  ['direct', 'Direct', atsHosts, [/apply/i, /submit application/i, /postular/i]],
];

export const platformDefinitions = new Map(configurations.map(([slug, notionName, hosts, applyLabels]) => [slug, {
  slug,
  notionName,
  sourceHosts: hosts,
  allowedDestinationHosts: [...new Set([...hosts, ...atsHosts])],
  applyLabels,
}]));

export const notionPlatformToSlug = Object.fromEntries(
  [...platformDefinitions.values()].map((definition) => [definition.notionName, definition.slug]),
);

