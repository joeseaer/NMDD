const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {splitWardrobeExport}=require('../scripts/split-wardrobe-export.cjs');
const {parseBundle,zipFiles}=require('../services/wardrobeBundle');
test('complete 101-item backup splits into valid v1 bundles without losing metadata/photos',async()=>{
  const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'nmdd-wardrobe-split-'));
  try {
    const source=await parseBundle(await fs.readFile(path.join(__dirname,'fixtures/wardrobe/mock-ten.zip')));
    const image=source.items[0],imagePath=`images/${image.image_sha256}.png`;
    const {bytes,info,...fields}=image;
    const items=Array.from({length:101},(_,index)=>({...fields,external_id:`restore-${index}`,image_path:imagePath}));
    const archive=await zipFiles(new Map([['manifest.json',Buffer.from(JSON.stringify({...source.manifest,source:'nmdd-export'}))],['items.json',Buffer.from(JSON.stringify(items))],[imagePath,bytes]]));
    const filename=path.join(temporary,'full.zip');await fs.writeFile(filename,archive);
    const output=path.join(temporary,'parts');const paths=await splitWardrobeExport(filename,output);assert.equal(paths.length,2);
    const first=await parseBundle(await fs.readFile(paths[0])),second=await parseBundle(await fs.readFile(paths[1]));
    assert.equal(first.items.length,100);assert.equal(second.items.length,1);assert.deepEqual(second.items[0].bytes,bytes);assert.equal(second.items[0].external_id,'restore-100');
    await assert.rejects(splitWardrobeExport(filename,output),/EEXIST/);
  } finally {await fs.rm(temporary,{recursive:true,force:true});}
});
