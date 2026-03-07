const fetch = require('node-fetch');

async function main() {
  const user_id = 'user-1';
  const mindmapJson = JSON.stringify({
    nodes: [{ id: 'root', type: 'mindMap', position: { x: 0, y: 0 }, data: { label: '中心主题' } }],
    edges: [],
  });
  const content = `# Mindmap Fence Test\n\n\`\`\`mindmap\n${mindmapJson}\n\`\`\`\n\nend`;

  let res = await fetch('http://localhost:3000/api/sop/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'MindMap Fence Save Test',
      category: 'note',
      content,
      user_id,
      version: 'V1.0',
      tags: [],
    }),
  });
  const createdText = await res.text();
  console.log('create', res.status, createdText);
  const created = JSON.parse(createdText);

  res = await fetch(`http://localhost:3000/api/sop/${user_id}`);
  const list = await res.json();
  const item = list.find((x) => x.id === created.id);
  console.log('fetched', {
    found: !!item,
    hasFence: !!item?.content?.includes('```mindmap'),
    len: item?.content?.length,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

