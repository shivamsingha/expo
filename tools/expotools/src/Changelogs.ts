import fs from 'fs-extra';
import semver from 'semver';

import * as Markdown from './Markdown';

export type Entry = {
  /**
   * The change note.
   */
  message: string;
  /**
   * The pull request number.
   */
  pullRequests?: number[];
  /**
   * GitHub's user names of someones who made this change.
   */
  authors?: string[];
};

/**
 * Type of the objects representing single changelog entry.
 */
export type ChangelogEntry = Entry & {
  /**
   * The type of changelog entry.
   */
  type: ChangeType;
  /**
   * The changelog section which contains this entry.
   */
  version: string;
  /**
   * Name of the group, usually name of the package where this change occurred.
   */
  groupName: string;
};

/**
 * Type of the objects representing changelog entries.
 */
export type ChangelogChanges = {
  totalCount: number;
  versions: Record<string, Partial<Record<ChangeType, string[]>>>;
};

/**
 * Enum with changelog sections that are commonly used by us.
 */
export enum ChangeType {
  BREAKING_CHANGES = '🛠 Breaking changes',
  NEW_FEATURES = '🎉 New features',
  BUG_FIXES = '🐛 Bug fixes',
}

/**
 * Heading name for unpublished changes.
 */
export const UNPUBLISHED_VERSION_NAME = 'master';

export const VERSION_EMPTY_PARAGRAPH_TEXT =
  '*This version does not introduce any user-facing changes.*';

/**
 * Depth of headings that mean the version containing following changes.
 */
const VERSION_HEADING_DEPTH = 2;

/**
 * Depth of headings that are being recognized as the type of changes (breaking changes, new features of bugfixes).
 */
const CHANGE_TYPE_HEADING_DEPTH = 3;

/**
 * Depth of the list that can be a group.
 */
const GROUP_LIST_ITEM_DEPTH = 0;

/**
 * Temporary array of possible headings that are treated as unpublished.
 * At the beginning we used to have `master` heading for unpublished changes,
 * however this seems strange when you're on different branch.
 */
const UNPUBLISHED_VERSION_NAMES = ['master', 'unpublished'];

/**
 * Class representing a changelog.
 */
export class Changelog {
  filePath: string;
  tokens: Markdown.Tokens | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Resolves to `true` if changelog file exists, `false` otherwise.
   */
  async fileExistsAsync(): Promise<boolean> {
    return await fs.pathExists(this.filePath);
  }

  /**
   * Lexifies changelog content and returns resulting tokens.
   */
  async getTokensAsync(): Promise<Markdown.Tokens> {
    if (!this.tokens) {
      try {
        const markdown = await fs.readFile(this.filePath, 'utf8');
        this.tokens = Markdown.lexify(markdown);
      } catch (error) {
        this.tokens = [];
      }
    }
    return this.tokens;
  }

  /**
   * Reads versions headers, collects those versions and returns them.
   */
  async getVersionsAsync(): Promise<string[]> {
    const tokens = await this.getTokensAsync();
    const versionTokens = tokens.filter(
      (token) => token.type === Markdown.TokenType.HEADING && token.depth === VERSION_HEADING_DEPTH
    ) as Markdown.HeadingToken[];

    return versionTokens.map((token) => token.text);
  }

  /**
   * Returns the last version in changelog.
   */
  async getLastPublishedVersionAsync(): Promise<string | null> {
    const versions = await this.getVersionsAsync();
    return versions.find((version) => semver.valid(version)) ?? null;
  }

  /**
   * Reads changes between two given versions and returns them in JS object format.
   * If called without params, then only unpublished changes are returned.
   */
  async getChangesAsync(
    fromVersion?: string,
    toVersion: string = UNPUBLISHED_VERSION_NAME
  ): Promise<ChangelogChanges> {
    const tokens = await this.getTokensAsync();
    const versions: ChangelogChanges['versions'] = {};
    const changes: ChangelogChanges = { totalCount: 0, versions };

    let currentVersion: string | null = null;
    let currentSection: string | null = null;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.type === Markdown.TokenType.HEADING) {
        if (token.depth === VERSION_HEADING_DEPTH) {
          if (token.text !== toVersion && (!fromVersion || token.text === fromVersion)) {
            // We've iterated over everything we needed, stop the loop.
            break;
          }

          currentVersion = UNPUBLISHED_VERSION_NAMES.includes(token.text)
            ? 'unpublished'
            : token.text;
          currentSection = null;

          if (!versions[currentVersion]) {
            versions[currentVersion] = {};
          }
        } else if (currentVersion && token.depth === CHANGE_TYPE_HEADING_DEPTH) {
          currentSection = token.text;

          if (!versions[currentVersion][currentSection]) {
            versions[currentVersion][currentSection] = [];
          }
        }
        continue;
      }

      if (currentVersion && currentSection && token.type === Markdown.TokenType.LIST) {
        for (const item of token.items) {
          changes.totalCount++;
          versions[currentVersion][currentSection].push(item.text);
        }
      }
    }
    return changes;
  }

  /**
   * Saves changes that we made in the array of tokens.
   */
  async saveAsync(): Promise<void> {
    // If tokens where not loaded yet, there is nothing to save.
    if (!this.tokens) {
      return;
    }

    // Parse cached tokens and write result to the file.
    await fs.outputFile(this.filePath, Markdown.render(this.tokens));

    // Reset cached tokens as we just modified the file.
    // We could use an array with new tokens here, but just for safety, let them be reloaded.
    this.tokens = null;
  }

  /**
   * Inserts given entry to changelog.
   */
  async addChangeAsync(entry: ChangelogEntry): Promise<void> {
    return this.insertEntriesAsync(entry.version, entry.type, entry.groupName, [entry]);
  }

  async insertEntriesAsync(
    version: string,
    type: ChangeType | string,
    group: string | null,
    entries: Entry[]
  ): Promise<void> {
    if (entries.length === 0) {
      return;
    }

    const tokens = await this.getTokensAsync();
    const sectionIndex = tokens.findIndex((token) => isVersionToken(token, version));

    if (sectionIndex === -1) {
      throw new Error(`Version ${version} not found.`);
    }

    for (let i = sectionIndex + 1; i < tokens.length; i++) {
      if (isVersionToken(tokens[i])) {
        // todo: add change type after sectionIndex
        return;
      }
      if (isChangeTypeToken(tokens[i], type)) {
        const changeTypeToken = tokens[i] as Markdown.HeadingToken;
        let list: Markdown.ListToken | null = null;
        let j = i + 1;

        for (; j < tokens.length; j++) {
          const item = tokens[j];
          if (item.type === Markdown.TokenType.LIST) {
            list = item;
            break;
          }
          if (item.type === Markdown.TokenType.HEADING && item.depth < changeTypeToken.depth) {
            break;
          }
        }
        if (!list) {
          list = Markdown.createListToken();
          tokens.splice(j, 0, list);
        }
        if (group) {
          let groupListItem = findGroup(list, group);

          if (!groupListItem) {
            groupListItem = Markdown.createListItemToken(getGroupLabel(group));
            list.items.push(groupListItem);
          }

          let groupList = groupListItem.tokens.find(
            (token) => token.type === Markdown.TokenType.LIST
          ) as Markdown.ListToken;

          if (!groupList) {
            groupList = Markdown.createListToken(GROUP_LIST_ITEM_DEPTH);
            groupListItem.tokens.push(groupList);
          }
          list = groupList;
        }

        for (const entry of entries) {
          const listItemLabel = getChangeEntryLabel(entry);
          const listItem = Markdown.createListItemToken(listItemLabel);

          list.depth = group ? 1 : 0;
          list.items.push(listItem);
        }

        return;
      }
    }
    throw new Error(`Cound't find '${type}' section.`);
  }

  /**
   * Renames header of unpublished changes to given version and adds new section with unpublished changes on top.
   */
  async cutOffAsync(version: string): Promise<void> {
    const tokens = [...(await this.getTokensAsync())];
    const firstVersionHeadingIndex = tokens.findIndex(isVersionToken);
    const newSectionTokens: Markdown.Tokens = [
      {
        type: Markdown.TokenType.HEADING,
        depth: VERSION_HEADING_DEPTH,
        text: UNPUBLISHED_VERSION_NAME,
      },
      {
        type: Markdown.TokenType.HEADING,
        depth: CHANGE_TYPE_HEADING_DEPTH,
        text: ChangeType.BREAKING_CHANGES,
      },
      {
        type: Markdown.TokenType.HEADING,
        depth: CHANGE_TYPE_HEADING_DEPTH,
        text: ChangeType.NEW_FEATURES,
      },
      {
        type: Markdown.TokenType.HEADING,
        depth: CHANGE_TYPE_HEADING_DEPTH,
        text: ChangeType.BUG_FIXES,
      },
    ];

    if (firstVersionHeadingIndex !== -1) {
      // Set version of the first found version header.
      (tokens[firstVersionHeadingIndex] as Markdown.HeadingToken).text = version;

      // Clean up empty sections.
      let i = firstVersionHeadingIndex + 1;
      while (i < tokens.length && !isVersionToken(tokens[i])) {
        // Remove change type token if its section is empty - when it is followed by another heading token.
        if (isChangeTypeToken(tokens[i])) {
          const nextToken = tokens[i + 1];
          if (!nextToken || isChangeTypeToken(nextToken) || isVersionToken(nextToken)) {
            tokens.splice(i, 1);
            continue;
          }
        }
        i++;
      }

      // `i` stayed the same after removing empty change type sections, so the entire version is empty.
      // Let's put an information that this version doesn't contain any user-facing changes.
      if (i === firstVersionHeadingIndex + 1) {
        tokens.splice(i, 0, {
          type: Markdown.TokenType.PARAGRAPH,
          text: VERSION_EMPTY_PARAGRAPH_TEXT,
        });
      }
    }

    // Insert new tokens before first version header.
    tokens.splice(firstVersionHeadingIndex, 0, ...newSectionTokens);

    // Parse tokens and write result to the file.
    await fs.outputFile(this.filePath, Markdown.render(tokens));

    // Reset cached tokens as we just modified the file.
    // We could use an array with new tokens here, but just for safety, let them be reloaded.
    this.tokens = null;
  }

  render() {
    if (!this.tokens) {
      throw new Error('Tokens have not been loaded yet!');
    }
    return Markdown.render(this.tokens);
  }
}

/**
 * Convenient method creating `Changelog` instance.
 */
export function loadFrom(path: string): Changelog {
  return new Changelog(path);
}

/**
 * Checks whether given token is interpreted as a token with a version.
 */
function isVersionToken(token: Markdown.Token, version?: string): token is Markdown.HeadingToken {
  return (
    token.type === Markdown.TokenType.HEADING &&
    token.depth === VERSION_HEADING_DEPTH &&
    (!version || token.text === version)
  );
}

/**
 * Checks whether given token is interpreted as a token with a change type.
 */
function isChangeTypeToken(
  token: Markdown.Token,
  changeType?: ChangeType | string
): token is Markdown.HeadingToken {
  return (
    token.type === Markdown.TokenType.HEADING &&
    token.depth === CHANGE_TYPE_HEADING_DEPTH &&
    (!changeType || token.text === changeType)
  );
}

/**
 * Checks whether given token is interpreted as a list group.
 */
function isGroupToken(token: Markdown.Token, groupName: string): token is Markdown.ListItemToken {
  if (token.type === Markdown.TokenType.LIST_ITEM && token.depth === GROUP_LIST_ITEM_DEPTH) {
    const firstToken = token.tokens[0];
    return (
      firstToken.type === Markdown.TokenType.TEXT && firstToken.text === getGroupLabel(groupName)
    );
  }
  return false;
}

/**
 * Finds list item that makes a group with given name.
 */
function findGroup(token: Markdown.ListToken, groupName: string): Markdown.ListItemToken | null {
  return token.items.find((item) => isGroupToken(item, groupName)) ?? null;
}

/**
 * Stringifies change entry object.
 */
function getChangeEntryLabel(entry: Entry): string {
  const pullRequests = entry.pullRequests || [];
  const authors = entry.authors || [];

  if (pullRequests.length + authors.length > 0) {
    const pullRequestsStr = pullRequests
      .map((pullRequest) => `[#${pullRequest}](https://github.com/expo/expo/pull/${pullRequest})`)
      .join(', ');

    const authorsStr = authors
      .map((author) => `[@${author}](https://github.com/${author})`)
      .join(', ');

    const pullRequestInformations = `${pullRequestsStr} by ${authorsStr}`.trim();
    return `${entry.message} (${pullRequestInformations})`;
  }
  return entry.message;
}

/**
 * Converts plain group name to its markdown representation.
 */
function getGroupLabel(groupName: string): string {
  return `**\`${groupName}\`**`;
}
