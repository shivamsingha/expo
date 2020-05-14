import marked from 'marked';
import { unescape } from 'lodash';

export enum TokenType {
  HEADING = 'heading',
  LIST = 'list',
  LIST_ITEM = 'listItem',
  PARAGRAPH = 'paragraph',
  TEXT = 'text',
  BLOCKQUOTE = 'blockquote',
  SPACE = 'space',
  CODE = 'code',
}

type SimpleToken<Type> = { type: Type; raw?: string };

export type TextToken<Type = TokenType.TEXT> = SimpleToken<Type> & { text: string };

export type HeadingToken = TextToken<TokenType.HEADING> & {
  depth: number;
  tokens: Token[];
};

export type ListToken = SimpleToken<TokenType.LIST> & {
  depth: number;
  items: ListItemToken[];
  ordered?: boolean;
  start?: string;
  loose?: boolean;
};

export type ListItemToken = TextToken<TokenType.LIST_ITEM> & {
  depth: number;
  tokens: Token[];
  task?: boolean;
  checked?: boolean;
  loose?: boolean;
};

export type ParagraphToken = TextToken<TokenType.PARAGRAPH>;

export type SpaceToken = SimpleToken<TokenType.SPACE>;

export type CodeToken = TextToken<TokenType.CODE> & {
  lang: string;
};

export type Token =
  | HeadingToken
  | ListToken
  | ListItemToken
  | ParagraphToken
  | TextToken
  | SpaceToken
  | CodeToken;

export interface Tokens extends Array<Token> {
  links?: any;
}

export interface Renderer {
  render(tokens: Token[]): string;
}

/**
 * Receives markdown text and returns an array of tokens.
 */
export function lexify(text: string): Tokens {
  const tokens = marked.lexer(text);
  recursivelyFixTokens(tokens);
  return tokens;
}

/**
 * Receives an array of tokens and renders them to markdown.
 */
export function render(tokens: Tokens, renderer: Renderer = new MarkdownRenderer()): string {
  // `marked` module is good enough in terms of lexifying, but its main purpose is to
  // convert markdown to html, so we need to write our own renderer for changelogs.
  return unescape(renderer.render(tokens).trim() + EOL);
}

/**
 * Returns a token from given text.
 */
export function createTextToken(text: string): TextToken {
  return {
    type: TokenType.TEXT,
    text,
  };
}

export function createListToken(depth: number = 1): ListToken {
  return {
    type: TokenType.LIST,
    depth,
    items: [],
  };
}

export function createListItemToken(text: string, depth: number = 0): ListItemToken {
  return {
    type: TokenType.LIST_ITEM,
    depth,
    text,
    tokens: [createTextToken(text)],
  };
}

/**
 * Fixes given tokens in place. We need to know depth of the list
 */
function recursivelyFixTokens(tokens: Token[], listDepth: number = 0): void {
  for (const token of tokens) {
    delete token.raw;

    if (token.type === TokenType.LIST) {
      token.depth = listDepth;

      for (const item of token.items) {
        delete item.raw;

        item.type = TokenType.LIST_ITEM;
        item.depth = listDepth;
        recursivelyFixTokens(item.tokens, listDepth + 1);
      }
    }
  }
}

const EOL = '\n';

export type RenderingContext = Partial<{
  indent: number;
  orderedList: boolean;
  itemIndex: number;
}>;

export class MarkdownRenderer implements Renderer {
  render(tokens: Token[]): string {
    let output = '';
    for (const token of tokens) {
      output += this.renderToken(token, { indent: 0 });
    }
    return output;
  }

  /* helpers */

  renderToken(token: Token, ctx: RenderingContext): string {
    switch (token.type) {
      case TokenType.HEADING:
        return this.heading(token);
      case TokenType.LIST:
        return this.list(token, ctx);
      case TokenType.LIST_ITEM:
        return this.listItem(token, ctx);
      case TokenType.PARAGRAPH:
        return this.paragraph(token);
      case TokenType.TEXT:
        return this.text(token);
      case TokenType.SPACE:
        return this.space(token);
      case TokenType.CODE:
        return this.code(token, ctx);
      default:
        // `marked` provides much more tokens, however we don't need to go so deep.
        // So far we needed only tokens with above types.
        throw new Error(`Cannot parse token with type: ${token!.type}`);
    }
  }

  indent(depth?: number, indentStr: string = '  '): string {
    return depth ? indentStr.repeat(depth) : '';
  }

  /* tokens */

  heading(token: HeadingToken): string {
    return this.indent(token.depth, '#') + ' ' + token.text + EOL.repeat(2);
  }

  list(token: ListToken, ctx: { indent?: number }): string {
    let output = '';
    for (let i = 0; i < token.items.length; i++) {
      output += this.listItem(token.items[i], {
        ...ctx,
        orderedList: token.ordered,
        itemIndex: i + 1,
      });
    }
    return output + EOL;
  }

  listItem(token: ListItemToken, ctx: RenderingContext): string {
    const indent = ctx.indent ?? 0;
    const bullet = ctx.orderedList ? `${ctx.itemIndex ?? 1}.` : '-';
    let output = this.indent(indent) + bullet + ' ';

    for (const child of token.tokens) {
      output += this.renderToken(child, { ...ctx, indent: indent + 1 }).trimRight() + EOL;
    }
    return output.trimRight() + EOL;
  }

  paragraph(token: ParagraphToken): string {
    return token.text + EOL;
  }

  text(token: TextToken): string {
    // TextToken may have children which we don't really need - they would render to `text` either way.
    return token.text;
  }

  space(token: SpaceToken): string {
    // Actually formatting of other tokens is good enough that we don't need to render additional newlines.
    return EOL;
  }

  code(token: CodeToken, ctx: RenderingContext): string {
    const lines = token.text.split(EOL);
    const indentStr = this.indent(ctx?.indent);

    lines.unshift('```' + token.lang ?? '');
    lines.push('```');

    return indentStr + lines.join(EOL + indentStr);
  }
}

// class ExpoChangelogRenderer {
//   heading(text: string, depth: number): string {
//     return '#'.repeat(depth) + ' ' + text + EOL.repeat(2);
//   }

//   list(body: string): string {
//     return body + EOL;
//   }

//   listitem(body: string): string {
//     return '- ' + body + EOL;
//   }

//   text(text: string): string {
//     return text;
//   }

//   paragraph(text: string): string {
//     return text + EOL;
//   }

//   blockquote(quote: string): string {
//     const text = quote
//       .split(EOL)
//       .map((line) => '> ' + line)
//       .join(EOL);

//     return text + EOL;
//   }

//   strong(text: string): string {
//     return '**' + text + '**';
//   }

//   em(text: string): string {
//     return '*' + text + '*';
//   }

//   del(text: string): string {
//     return '~~' + text + '~~';
//   }

//   codespan(text: string): string {
//     return '`' + text + '`';
//   }

//   code(text: string, infoString: string): string {
//     return '```' + infoString + EOL + text + EOL + '```' + EOL;
//   }

//   link(href: string, title: string, text: string): string {
//     return '[' + text + '](' + href + ')';
//   }
// }
