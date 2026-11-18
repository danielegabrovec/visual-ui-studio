const { existsSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { basename, extname, join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const output = join(root, 'THIRD-PARTY-NOTICES.txt');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const noticeName = /^(?:licen[cs]es?|copying|unlicense|notices?|copyright(?:[-_ ]?notice)?|third[-_ ]?party[-_ ]?(?:licen[cs]es?|notices?))(?=$|[. _-])/i;
const textExtensions = new Set(['', '.txt', '.md', '.markdown', '.rst', '.html']);

function parseOptions(args) {
  let installation = root;
  let check = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--check') {
      check = true;
    } else if (args[i] === '--installation' && args[i + 1] && !args[i + 1].startsWith('--')) {
      installation = resolve(args[++i]);
    } else {
      throw new Error('Usage: node scripts/generate-third-party-notices.cjs [--installation <npm project root>] [--check]');
    }
  }
  return { installation, check };
}

function productionPackages() {
  if (lock.lockfileVersion < 2 || !lock.packages) {
    throw new Error('Expected a package-lock with an installed-package map.');
  }
  return Object.keys(lock.packages)
    .filter((path) => path.startsWith('node_modules/') && !lock.packages[path].dev)
    .sort();
}

function findNoticeFiles(directory, inNoticesDirectory = false) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const namedNotice = noticeName.test(entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      return findNoticeFiles(path, inNoticesDirectory || namedNotice);
    }
    return entry.isFile() && (inNoticesDirectory || namedNotice) && textExtensions.has(extname(entry.name).toLowerCase())
      ? [path]
      : [];
  }).sort();
}

function findReadmeLicense(directory) {
  const readme = readdirSync(directory).find((file) => /^readme(?:\.md|\.markdown)?$/i.test(file));
  if (!readme) return null;
  const text = readFileSync(join(directory, readme), 'utf8');
  const heading = /^ {0,3}(#{1,6})[\t ]+licen[cs]es?[\t ]*#*[\t ]*(?:\r?\n|$)/im.exec(text);
  if (!heading) return null;
  const afterHeading = heading.index + heading[0].length;
  const nextSection = new RegExp(`^ {0,3}#{1,${heading[1].length}}[\\t ]+`, 'm').exec(text.slice(afterHeading));
  const end = nextSection ? afterHeading + nextSection.index : text.length;
  return { path: `${readme} (License section)`, bytes: Buffer.from(text.slice(heading.index, end)) };
}

function getNotices(directory) {
  const files = findNoticeFiles(directory).map((path) => ({
    path: relative(directory, path).split('\\').join('/'),
    bytes: readFileSync(path),
  }));
  if (files.some(({ path }) => /^(?:licen[cs]es?|copying|unlicense)/i.test(basename(path)))) return files;
  const readme = findReadmeLicense(directory);
  return readme ? [...files, readme] : files;
}

function generate(installation) {
  const packages = productionPackages();
  const electron = lock.packages['node_modules/electron']?.version;
  const chunks = [Buffer.from([
    'Visual UI Studio - Third-party notices',
    '======================================',
    '',
    `This file reproduces license and notice texts supplied with the ${packages.length} production npm packages for version ${lock.version}.`,
    `The separately distributed Electron runtime${electron ? ` (${electron})` : ''} includes its own license and the Chromium third-party notices.`,
    'See LICENSE.electron.txt (LICENSE in the original Electron distribution) and LICENSES.chromium.html alongside the executable.',
    '',
  ].join('\n'))];
  let noticeCount = 0;

  for (const packagePath of packages) {
    const locked = lock.packages[packagePath];
    const directory = join(installation, packagePath);
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (manifest.version !== locked.version || (locked.name && manifest.name !== locked.name)) {
      throw new Error(`Installed package does not match the lock at ${packagePath}: ${manifest.name}@${manifest.version} vs ${locked.version}.`);
    }
    const notices = getNotices(directory);
    if (!notices.length || notices.some(({ bytes }) => !bytes.length)) {
      throw new Error(`License/notice text missing or empty for ${manifest.name}@${manifest.version} (${packagePath}).`);
    }
    const license = typeof manifest.license === 'string' ? manifest.license : locked.license;
    chunks.push(Buffer.from(`\n================================================================================\n${manifest.name}@${manifest.version}${license ? ` | ${license}` : ''}\n${packagePath}\n`));
    for (const notice of notices) {
      chunks.push(Buffer.from(`\n--- ${notice.path} ---\n`), notice.bytes, Buffer.from('\n'));
      noticeCount += 1;
    }
  }
  return { buffer: Buffer.concat(chunks), packageCount: packages.length, noticeCount };
}

try {
  const { installation, check } = parseOptions(process.argv.slice(2));
  const { buffer, packageCount, noticeCount } = generate(installation);
  if (check) {
    if (!existsSync(output) || !readFileSync(output).equals(buffer)) {
      throw new Error('THIRD-PARTY-NOTICES.txt differs from the generated notices. Run this script without --check.');
    }
  } else {
    writeFileSync(output, buffer);
  }
  process.stdout.write(`${check ? 'Verified' : 'Generated'} THIRD-PARTY-NOTICES.txt (${packageCount} packages, ${noticeCount} source texts).\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
