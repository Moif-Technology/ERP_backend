import sys, json
from graphify.extract import collect_files, extract
from pathlib import Path

result = json.loads(Path('.graphify_incremental.json').read_text())
new_files = result.get('new_files', {})
code_files = [Path(f) for f in new_files.get('code', [])]

if code_files:
    r = extract(code_files)
    Path('.graphify_ast.json').write_text(json.dumps(r, indent=2))
    print('AST: ' + str(len(r['nodes'])) + ' nodes, ' + str(len(r['edges'])) + ' edges')
else:
    Path('.graphify_ast.json').write_text(json.dumps({'nodes':[],'edges':[],'input_tokens':0,'output_tokens':0}))
    print('No code files')
