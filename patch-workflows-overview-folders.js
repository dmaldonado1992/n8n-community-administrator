const fs = require('fs');
const path = require('path');

const MARKER = 'n8n-community-overview-folders-v1';
const PROJECT_ID = process.env.N8N_OVERVIEW_PROJECT_ID || 'qf2qkg0rLdugskSX';

function log(message) {
  console.log(`[OVERVIEW_FOLDERS] ${message}`);
}

function warn(message) {
  console.warn(`[OVERVIEW_FOLDERS] ${message}`);
}

function resolvePackageRoot(packageName, paths = [process.cwd()]) {
  const packageJson = require.resolve(`${packageName}/package.json`, { paths });
  return path.dirname(packageJson);
}

function patchBackend(n8nRoot) {
  const file = path.join(n8nRoot, 'dist', 'workflows', 'workflow.service.js');
  if (!fs.existsSync(file)) {
    warn(`backend file not found: ${file}`);
    return false;
  }

  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(MARKER)) {
    log('backend already patched');
    return true;
  }

  const methodPattern = /async\s+getMany\(user,\s*options,\s*includeScopes,\s*includeFolders,\s*onlySharedWithMe\)\s*\{/;
  const match = source.match(methodPattern);
  if (!match) {
    warn('could not locate WorkflowService.getMany; backend left unchanged');
    return false;
  }

  const injection = `${match[0]}\n        /* ${MARKER} */\n        // n8n hides folders in the global Workflows/Overview page.\n        // Scope folder-enabled overview requests to this instance's Personal project\n        // and return only root-level resources. Searches keep the whole folder tree.\n        if (includeFolders && !onlySharedWithMe && !options?.filter?.projectId) {\n            options = {\n                ...(options ?? {}),\n                filter: {\n                    ...(options?.filter ?? {}),\n                    projectId: '${PROJECT_ID}',\n                },\n            };\n            if (!options.filter.query && !options.filter.parentFolderId) {\n                options.filter.parentFolderId = '0';\n            }\n        }`;

  source = source.replace(methodPattern, injection);
  fs.writeFileSync(file, source);
  log(`backend patched for Personal project ${PROJECT_ID}`);
  return true;
}

function patchEditorUi(n8nRoot) {
  let editorRoot;
  try {
    editorRoot = resolvePackageRoot('n8n-editor-ui', [n8nRoot, process.cwd()]);
  } catch (error) {
    warn(`could not resolve n8n-editor-ui: ${error.message}`);
    return false;
  }

  const assetsDir = path.join(editorRoot, 'dist', 'assets');
  if (!fs.existsSync(assetsDir)) {
    warn(`editor assets directory not found: ${assetsDir}`);
    return false;
  }

  const files = fs
    .readdirSync(assetsDir)
    .filter((name) => /^WorkflowsView-.*\.js$/.test(name) && !name.endsWith('.map'))
    .map((name) => path.join(assetsDir, name));

  if (!files.length) {
    warn('no WorkflowsView JavaScript chunks found');
    return false;
  }

  let folderVisibilityChanges = 0;
  let folderRouteChanges = 0;

  for (const file of files) {
    let source = fs.readFileSync(file, 'utf8');
    if (source.includes(MARKER)) {
      log(`${path.basename(file)} already patched`);
      continue;
    }

    const original = source;

    // Source equivalent in n8n 1.123.65:
    // foldersEnabled.value && !projectPages.isOverviewSubPage && !projectPages.isSharedSubPage
    // Keep Shared With Me unchanged, but allow folders in Overview/Workflows.
    source = source.replace(
      /([A-Za-z_$][\w$]*)\.value\s*&&\s*!([A-Za-z_$][\w$]*)\.isOverviewSubPage\s*&&\s*!\2\.isSharedSubPage/g,
      (_whole, foldersRef, projectPagesRef) => {
        folderVisibilityChanges += 1;
        return `${foldersRef}.value&&!${projectPagesRef}.isSharedSubPage`;
      },
    );

    // FolderCard normally builds its URL from route.params.projectId. Overview has no
    // projectId route param, so fall back to the known Personal project. Existing
    // project-scoped routes keep their current project ID.
    source = source.replace(
      /projectId\s*:\s*([A-Za-z_$][\w$]*)\.params\.projectId\s*,\s*folderId\s*:/g,
      (_whole, routeRef) => {
        folderRouteChanges += 1;
        return `projectId:${routeRef}.params.projectId||\"${PROJECT_ID}\",folderId:`;
      },
    );

    if (source !== original) {
      source += `\n/* ${MARKER} */\n`;
      fs.writeFileSync(file, source);
      log(`patched ${path.basename(file)}`);
    }
  }

  if (!folderVisibilityChanges) {
    warn('folder visibility pattern was not found; UI behavior was not changed');
  }
  if (!folderRouteChanges) {
    warn('folder route fallback pattern was not found; folder navigation may need a version-specific adjustment');
  }

  log(`editor patch summary: visibility=${folderVisibilityChanges}, routes=${folderRouteChanges}`);
  return folderVisibilityChanges > 0;
}

function main() {
  let n8nRoot;
  try {
    n8nRoot = resolvePackageRoot('n8n');
  } catch (error) {
    warn(`could not resolve n8n: ${error.message}`);
    process.exit(0);
  }

  const backendOk = patchBackend(n8nRoot);
  const editorOk = patchEditorUi(n8nRoot);

  if (backendOk && editorOk) {
    log('patch ready: Workflows overview can render Personal folders');
  } else {
    // Never make a deployment fail because of this optional UI customization.
    warn('patch was only partially applied; n8n will continue with its stock UI where necessary');
  }
}

main();
