const fetch = require('node-fetch');

async function main() {
  const res = await fetch('http://localhost:3000/api/sop/user-1');
  const arr = await res.json();
  const mm = arr.filter(
    (x) => typeof x.content === 'string' && (x.content.includes('```mindmap') || x.content.includes('data-type="mind-map"'))
  );

  console.log('total', arr.length, 'mindmap', mm.length);
  mm.slice(0, 10).forEach((x) => {
    console.log(x.id, x.title, x.content.length, x.content.includes('```mindmap'));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

