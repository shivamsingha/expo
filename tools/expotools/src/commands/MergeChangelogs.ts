import { Command } from '@expo/commander';
import path from 'path';

import { getListOfPackagesAsync } from '../Packages';
import { Changelog, ChangelogChanges } from '../Changelogs';
import { EXPO_DIR } from '../Constants';
import chalk from 'chalk';

const MAIN_CHANGELOG_PATH = path.join(EXPO_DIR, 'CHANGELOG.md');

export default (program: Command) => {
  program
    .command('merge-changelogs')
    .alias('mc')
    .description('Merges packages changelogs into the root one.')
    .asyncAction(action);
};

async function action() {
  // const changelog = new Changelog(path.join(EXPO_DIR, 'packages/expo-updates/CHANGELOG.md'));
  // const tokens = await changelog.getTokensAsync();

  // await changelog.addChangeAsync({
  //   type: ChangeType.BUG_FIXES,
  //   message: 'test',
  //   authors: ['tsapeta'],
  //   pullRequests: [2137],
  //   version: 'master',
  //   groupName: 'expo-gl-objc',
  // });

  // console.log('TOKENS', chalk.yellow(JSON.stringify(tokens, null, 2)));
  // console.log(changelog.render());
  // await changelog.saveAsync();

  const packages = await getListOfPackagesAsync();
  const changelogChanges: Record<string, ChangelogChanges> = {};
  const mainChangelog = new Changelog(MAIN_CHANGELOG_PATH);

  await Promise.all(
    packages
      // .filter((pkg) => pkg.packageName === 'expo-updates')
      .map(async (pkg) => {
        const changelog = new Changelog(pkg.changelogPath);

        if (!(await changelog.fileExistsAsync())) {
          return;
        }
        const changes = await changelog.getChangesAsync();

        if (changes.totalCount > 0) {
          changelogChanges[pkg.packageName] = changes;
        }
      })
  );

  const sortedPackageNames = Object.keys(changelogChanges).sort();
  const tokens = await mainChangelog.getTokensAsync();

  for (const packageName of sortedPackageNames) {
    for (const [version, changes] of Object.entries(changelogChanges[packageName].versions)) {
      for (const type in changes) {
        const entries = changes[type].map((entryMessage) => ({ message: entryMessage }));
        await mainChangelog.insertEntriesAsync('master', type, packageName, entries);
      }
    }
  }

  await mainChangelog.saveAsync();

  // console.log(changelogChanges);
  // console.log(...tokens.slice(0, 16).map((token) => JSON.stringify(token, null, 2)));
  // console.log(mainChangelog.render());
}
