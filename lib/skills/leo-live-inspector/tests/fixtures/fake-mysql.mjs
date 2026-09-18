import fs from 'node:fs';

const eventFile = process.env.LEO_TEST_MYSQL_EVENT_FILE;

function record(event) {
  if (!eventFile) throw new Error('LEO_TEST_MYSQL_EVENT_FILE is required');
  fs.appendFileSync(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
}

record({ type: 'module-loaded' });

function resultFor(sql) {
  const keyword = sql.trim().replace(/^(?:\/\*[\s\S]*?\*\/|--[^\r\n]*(?:\r?\n|$)|#[^\r\n]*(?:\r?\n|$)|\s)*/g, '').split(/\s+/, 1)[0].toUpperCase();

  if (keyword === 'SELECT') {
    return [
      [{ id: 7, name: 'Ada' }],
      [{ name: 'id' }, { name: 'name' }]
    ];
  }

  const results = {
    INSERT: { affectedRows: 1, insertId: 42, changedRows: 0, warningStatus: 0 },
    UPDATE: { affectedRows: 1, insertId: 0, changedRows: 1, warningStatus: 2 },
    DELETE: { affectedRows: 1, insertId: 0, changedRows: 0, warningStatus: 0 },
    REPLACE: { affectedRows: 2, insertId: 0, changedRows: 1, warningStatus: 0 },
    CREATE: { affectedRows: 0, insertId: 0, changedRows: 0, warningStatus: 0 },
    ALTER: { affectedRows: 0, insertId: 0, changedRows: 0, warningStatus: 0 },
    DROP: { affectedRows: 0, insertId: 0, changedRows: 0, warningStatus: 0 },
    TRUNCATE: { affectedRows: 0, insertId: 0, changedRows: 0, warningStatus: 0 }
  };

  return [results[keyword] || [], []];
}

export async function createConnection() {
  record({ type: 'connect' });
  return {
    async query(sql) {
      record({ type: 'query', sql });
      return resultFor(sql);
    },
    async end() {
      record({ type: 'end' });
    }
  };
}

export default { createConnection };
