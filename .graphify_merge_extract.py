import json
from pathlib import Path

# Create empty semantic file since code-only
sem = {'nodes': [], 'edges': [], 'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0}
Path('.graphify_semantic.json').write_text(json.dumps(sem))

ast = json.loads(Path('.graphify_ast.json').read_text())
merged = {
    'nodes': ast['nodes'],
    'edges': ast['edges'],
    'hyperedges': [],
    'input_tokens': 0,
    'output_tokens': 0,
}
Path('.graphify_extract.json').write_text(json.dumps(merged, indent=2))
print('Extract: ' + str(len(merged['nodes'])) + ' nodes, ' + str(len(merged['edges'])) + ' edges')
