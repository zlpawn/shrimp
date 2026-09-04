const QUERY_KEYWORDS = new Set(['SELECT', 'SHOW', 'DESC', 'DESCRIBE', 'EXPLAIN']);
const DML_KEYWORDS = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE']);
const DDL_KEYWORDS = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE']);

function unknownResult() {
  return {
    keyword: 'UNKNOWN',
    category: 'UNKNOWN',
    isWrite: false,
    guardRequired: false,
    hasTopLevelWhere: null,
    tableName: null
  };
}

function tokenizeSql(sql) {
  const tokens = [];
  let index = 0;
  let depth = 0;
  let complete = true;

  const addToken = (type, value, tokenDepth, raw = value) => {
    tokens.push({ type, value, raw, depth: tokenDepth });
  };

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === '-' && next === '-' && (index + 2 === sql.length || /\s/.test(sql[index + 2]))) {
      index += 2;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      continue;
    }

    if (char === '#') {
      index += 1;
      while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', index + 2);
      if (end === -1) {
        complete = false;
        break;
      }
      index = end + 2;
      continue;
    }

    if (char === "'" || char === '"') {
      const quote = char;
      index += 1;
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === '\\') {
          index += 2;
          continue;
        }
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed) complete = false;
      continue;
    }

    if (char === '`') {
      index += 1;
      let value = '';
      let closed = false;
      while (index < sql.length) {
        if (sql[index] === '`') {
          if (sql[index + 1] === '`') {
            value += '`';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += sql[index];
        index += 1;
      }
      if (!closed) {
        complete = false;
        break;
      }
      addToken('identifier', value, depth);
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) index += 1;
      const value = sql.slice(start, index);
      addToken('word', value.toUpperCase(), depth, value);
      continue;
    }

    if (char === '(') {
      addToken('punctuation', char, depth);
      depth += 1;
      index += 1;
      continue;
    }

    if (char === ')') {
      if (depth === 0) complete = false;
      depth = Math.max(0, depth - 1);
      addToken('punctuation', char, depth);
      index += 1;
      continue;
    }

    addToken('punctuation', char, depth);
    index += 1;
  }

  if (depth !== 0) complete = false;
  return { tokens, complete };
}

function wordAt(tokens, index, value) {
  return tokens[index]?.type === 'word' && tokens[index].value === value;
}

function tokenAt(tokens, index, type, value) {
  return tokens[index]?.type === type && tokens[index].value === value;
}

function findMainStatement(tokens) {
  if (!tokens.length) return null;
  if (!wordAt(tokens, 0, 'WITH')) return tokens[0].depth === 0 ? 0 : null;

  let index = 1;
  if (wordAt(tokens, index, 'RECURSIVE')) index += 1;

  while (index < tokens.length) {
    let asIndex = index;
    while (asIndex < tokens.length && !(tokens[asIndex].depth === 0 && wordAt(tokens, asIndex, 'AS'))) {
      asIndex += 1;
    }
    if (asIndex >= tokens.length || !tokenAt(tokens, asIndex + 1, 'punctuation', '(') || tokens[asIndex + 1].depth !== 0) {
      return null;
    }

    const openIndex = asIndex + 1;
    const bodyDepth = tokens[openIndex].depth + 1;
    let closeIndex = openIndex + 1;
    while (closeIndex < tokens.length && !(tokenAt(tokens, closeIndex, 'punctuation', ')') && tokens[closeIndex].depth === bodyDepth - 1)) {
      closeIndex += 1;
    }
    if (closeIndex >= tokens.length) return null;

    index = closeIndex + 1;
    if (tokenAt(tokens, index, 'punctuation', ',')) {
      index += 1;
      continue;
    }
    return tokens[index]?.depth === 0 ? index : null;
  }

  return null;
}

function findTopLevelWhere(tokens, statementIndex) {
  for (let index = statementIndex + 1; index < tokens.length; index += 1) {
    if (tokens[index].depth === 0 && wordAt(tokens, index, 'WHERE')) return true;
  }
  return false;
}

function identifierPart(token) {
  if (!token) return null;
  if (token.type === 'identifier' || token.type === 'word') return token.raw;
  return null;
}

function extractTableName(tokens, statementIndex, keyword) {
  let index = statementIndex + 1;
  if (keyword === 'CREATE' && wordAt(tokens, index, 'TEMPORARY')) index += 1;
  if (wordAt(tokens, index, 'TABLE')) index += 1;
  else if (keyword !== 'TRUNCATE') return null;

  if (keyword === 'CREATE' && wordAt(tokens, index, 'IF') && wordAt(tokens, index + 1, 'NOT') && wordAt(tokens, index + 2, 'EXISTS')) {
    index += 3;
  } else if ((keyword === 'DROP') && wordAt(tokens, index, 'IF') && wordAt(tokens, index + 1, 'EXISTS')) {
    index += 2;
  }

  const first = identifierPart(tokens[index]);
  if (!first) return null;
  index += 1;
  if (!tokenAt(tokens, index, 'punctuation', '.')) return first;

  const second = identifierPart(tokens[index + 1]);
  return second ? `${first}.${second}` : null;
}

export function analyzeSql(sql) {
  if (typeof sql !== 'string' || sql.trim() === '') return unknownResult();

  const { tokens, complete } = tokenizeSql(sql);
  const statementIndex = findMainStatement(tokens);
  const statementToken = statementIndex === null ? null : tokens[statementIndex];
  const keyword = statementToken?.type === 'word' ? statementToken.value : 'UNKNOWN';
  const category = QUERY_KEYWORDS.has(keyword) ? 'QUERY'
    : DML_KEYWORDS.has(keyword) ? 'DML'
      : DDL_KEYWORDS.has(keyword) ? 'DDL'
        : 'UNKNOWN';

  if (category === 'UNKNOWN') return unknownResult();

  const guardRequired = keyword === 'UPDATE' || keyword === 'DELETE';
  const hasTopLevelWhere = guardRequired
    ? (complete ? findTopLevelWhere(tokens, statementIndex) : null)
    : null;

  return {
    keyword,
    category,
    isWrite: category === 'DML' || category === 'DDL',
    guardRequired,
    hasTopLevelWhere,
    tableName: category === 'DDL' ? extractTableName(tokens, statementIndex, keyword) : null
  };
}

export function looksLikeSql(sql) {
  return analyzeSql(sql).keyword !== 'UNKNOWN';
}
