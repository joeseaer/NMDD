const fetch = require('node-fetch');

async function main() {
  const user_id = 'user-1';
  const content = `\n\n<div data-type="mind-map" data-mindmap="%7B%5C%22nodes%5C%22%3A%5B%7B%5C%22id%5C%22%3A%5C%22root%5C%22%2C%5C%22type%5C%22%3A%5C%22mindMap%5C%22%2C%5C%22position%5C%22%3A%7B%5C%22x%5C%22%3A0%2C%5C%22y%5C%22%3A0%7D%2C%5C%22data%5C%22%3A%7B%5C%22label%5C%22%3A%5C%22Center%5C%22%7D%7D%5D%2C%5C%22edges%5C%22%3A%5B%5D%7D"></div>\n\n`;

  let res = await fetch('http://localhost:3000/api/sop/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'MindMap Save Test',
      category: 'note',
      content,
      user_id,
      version: 'V1.0',
      tags: [],
    }),
  });
  const createdText = await res.text();
  console.log('create status', res.status, createdText);
  const created = JSON.parse(createdText);
  const id = created.id;

  res = await fetch('http://localhost:3000/api/sop/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      title: 'MindMap Save Test',
      category: 'note',
      content: content + 'updated',
      user_id,
      version: 'V1.0',
      tags: [],
    }),
  });
  const updatedText = await res.text();
  console.log('update status', res.status, updatedText);

  res = await fetch(`http://localhost:3000/api/sop/${user_id}`);
  const all = await res.json();
  const item = all.find((x) => x.id === id);
  console.log('fetched exists', !!item);
  console.log('fetched has div', item?.content?.includes('data-type="mind-map"'));
  console.log('len', item?.content?.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

