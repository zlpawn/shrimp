import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parseXlsxBase64WithPython, runPythonCode } from '../scripts/common/xlsx.js';

function buildXlsxBase64(sheetXml, sharedXml = '') {
  const python = `
import zipfile, io, base64, sys
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w') as zf:
    zf.writestr('xl/worksheets/sheet1.xml', sys.argv[1])
    if sys.argv[2]:
        zf.writestr('xl/sharedStrings.xml', sys.argv[2])
sys.stdout.write(base64.b64encode(buf.getvalue()).decode())
`;
  const result = spawnSync('python3', ['-c', python, sheetXml, sharedXml], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('runPythonCode should fall back when the preferred Python command is missing', () => {
  const child = runPythonCode('', ['leo-definitely-missing-python3', 'python3']);

  assert.equal(child.error, undefined);
  assert.ok(child.stdout.includes('error'));
});

test('runPythonCode should report all missing Python candidates', () => {
  const child = runPythonCode('', ['leo-definitely-missing-python3', 'leo-definitely-missing-python']);

  assert.ok(child.error);
  assert.match(child.error.message, /leo-definitely-missing-python3.*leo-definitely-missing-python/);
});

test('parseXlsxBase64WithPython should keep empty cells as empty strings', () => {
  const sheet = `<?xml version="1.0"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="s"><v>2</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>3</v></c>
      <c r="B2" t="s"><v></v></c>
      <c r="C2" t="s"><v>4</v></c>
    </row>
    <row r="3">
      <c r="A3" t="s"><v>5</v></c>
      <c r="C3" t="s"><v>6</v></c>
    </row>
  </sheetData>
</worksheet>`;
  const shared = `<?xml version="1.0"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>id</t></si>
  <si><t>name</t></si>
  <si><t>status</t></si>
  <si><t>1</t></si>
  <si><t>ok</t></si>
  <si><t>2</t></si>
  <si><t>active</t></si>
</sst>`;

  const parsed = parseXlsxBase64WithPython(buildXlsxBase64(sheet, shared));

  assert.deepEqual(parsed, [
    ['id', 'name', 'status'],
    ['1', '', 'ok'],
    ['2', '', 'active']
  ]);
});
