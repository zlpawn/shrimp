import { spawnSync } from 'node:child_process';

const PYTHON_CODE = `
import sys, base64, io, zipfile, json
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

def col_index(cell_ref):
    letters = ''.join(ch for ch in (cell_ref or '') if ch.isalpha())
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1 if n else 0

def cell_value(cell, shared_strings):
    t_type = cell.get('t')
    value_node = cell.find('%sv' % NS)
    val = '' if value_node is None or value_node.text is None else value_node.text
    if t_type == 's' and val.isdigit():
        idx = int(val)
        val = shared_strings[idx] if idx < len(shared_strings) else val
    return val

try:
    b64_str = sys.stdin.read().strip()
    zf = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64_str)))
    shared_strings = []
    if 'xl/sharedStrings.xml' in zf.namelist():
        tree = ET.fromstring(zf.read('xl/sharedStrings.xml'))
        for si in tree.findall('%ssi' % NS):
            texts = [t.text or '' for t in si.findall('.//%st' % NS)]
            shared_strings.append(''.join(texts))

    tree = ET.fromstring(zf.read('xl/worksheets/sheet1.xml'))
    sparse_rows = []
    max_col = -1
    for row in tree.findall('.//%srow' % NS):
        row_map = {}
        next_idx = 0
        for cell in row.findall('%sc' % NS):
            ref = cell.get('r')
            idx = col_index(ref) if ref else next_idx
            next_idx = idx + 1
            row_map[idx] = cell_value(cell, shared_strings)
            if idx > max_col:
                max_col = idx
        if any(row_map.values()):
            sparse_rows.append(row_map)
    rows = [[row_map.get(i, '') for i in range(max_col + 1)] for row_map in sparse_rows] if max_col >= 0 else []
    print(json.dumps(rows, ensure_ascii=False))
except Exception as e:
    print(json.dumps({"error": str(e)}))
`;

export function runPythonCode(input, candidates = ['python3', 'python']) {
  const errors = [];

  for (const command of candidates) {
    const child = spawnSync(command, ['-c', PYTHON_CODE], {
      input,
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024
    });

    if (!child.error) return child;
    errors.push(`${command}: ${child.error.message}`);
  }

  return { error: new Error(errors.join('; ')) };
}

export function parseXlsxBase64WithPython(b64Data, candidates = ['python3', 'python']) {
  const child = runPythonCode(b64Data, candidates);

  if (child.error) {
    return { error: child.error.message };
  }

  try {
    return JSON.parse(child.stdout);
  } catch {
    return { error: `Failed to parse python json output: ${child.stdout}` };
  }
}
