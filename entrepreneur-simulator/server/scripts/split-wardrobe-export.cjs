// Offline recovery helper: preserves v1 while splitting a complete export into import-sized bundles.
const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const { normalizeItem, imageInfo, zipFiles, parseBundle, ensure, LIMITS } = require('../services/wardrobeBundle');
async function splitWardrobeExport(source, destination) {
  const zip = await new Promise((resolve,reject)=>yauzl.open(source,{lazyEntries:true,autoClose:false,strictFileNames:true,validateEntrySizes:true},(error,value)=>error?reject(error):resolve(value)));
  try {
    const entries = await new Promise((resolve,reject)=>{
      const files=new Map(); zip.on('error',reject); zip.on('end',()=>resolve(files));
      zip.on('entry',entry=>{
        const name=entry.fileName, kind=(entry.externalFileAttributes>>>16)&0xf000;
        if (files.size>=100002 || files.has(name) || (kind && kind!==0x8000 && kind!==0x4000) || (entry.generalPurposeBitFlag&1)
          || !(/^(manifest|items)\.json$/.test(name) || name==='images/' || /^images\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(name))) { reject(new Error('只支持 NMDD 导出的安全备份 ZIP')); zip.close(); return; }
        files.set(name,entry); zip.readEntry();
      }); zip.readEntry();
    });
    async function read(name, max) {
      const entry=entries.get(name); ensure(entry && entry.uncompressedSize<=max,`备份文件缺失或超限：${name}`);
      return new Promise((resolve,reject)=>zip.openReadStream(entry,(error,stream)=>{
        if(error)return reject(error); const chunks=[]; let size=0;
        stream.on('error',reject);stream.on('data',chunk=>{size+=chunk.length;if(size>max){stream.destroy(new Error('备份文件解压超限'));}else chunks.push(chunk);});stream.on('end',()=>resolve(Buffer.concat(chunks)));
      }));
    }
    const manifest=JSON.parse((await read('manifest.json',LIMITS.json)).toString('utf8'));
    ensure(manifest.format==='nmdd-wardrobe'&&manifest.schema_version===1&&manifest.source==='nmdd-export','需要 NMDD 导出的 v1 备份');
    const raw=JSON.parse((await read('items.json',64*1024*1024)).toString('utf8'));ensure(Array.isArray(raw)&&raw.length<=100000,'备份衣物列表无效');
    const items=raw.map(value=>normalizeItem(value)); const seen=new Set();
    for(const item of items){ensure(!seen.has(item.external_id),'备份含重复 external_id');seen.add(item.external_id);}
    await fs.mkdir(destination,{recursive:true});
    const outputs=[];let batch=[],images=new Map(),byteSize=0;
    async function flush() {
      if(!batch.length && outputs.length)return;
      const bytes=await zipFiles(new Map([...images,
        ['manifest.json',Buffer.from(JSON.stringify({...manifest,batch_id:`restore-${outputs.length+1}`,created_at:new Date().toISOString()}))],
        ['items.json',Buffer.from(JSON.stringify(batch))],
      ]));
      await parseBundle(bytes); // Reapply the exact server-side 100-item/60MB/150MB contract.
      const target=path.join(destination,`nmdd-wardrobe-restore-${String(outputs.length+1).padStart(3,'0')}.zip`);
      await fs.writeFile(target,bytes,{flag:'wx'});outputs.push(target);batch=[];images=new Map();byteSize=0;
    }
    for(const item of items){
      const entry=entries.get(item.image_path);ensure(entry,'备份图片缺失');
      const extra=images.has(item.image_path)?0:entry.uncompressedSize;
      // Keep room for metadata and ZIP headers even for incompressible images.
      if(batch.length && (batch.length===100 || byteSize+extra>48*1024*1024))await flush();
      if(!images.has(item.image_path)){
        const bytes=await read(item.image_path,LIMITS.image);const info=imageInfo(bytes,item.image_path);
        ensure(!item.image_sha256||item.image_sha256===info.sha256,'备份图片 SHA-256 不匹配');
        images.set(item.image_path,bytes);byteSize+=bytes.length;
      }
      batch.push(item);
    }
    if(batch.length || !outputs.length)await flush();
    return outputs;
  } finally {zip.close();}
}
module.exports={splitWardrobeExport};
if(require.main===module){
  const [source,destination]=process.argv.slice(2);
  if(!source||!destination){console.error('Usage: node scripts/split-wardrobe-export.cjs <export.zip> <new-output-folder>');process.exitCode=1;}
  else splitWardrobeExport(path.resolve(source),path.resolve(destination)).then(files=>console.log(`已生成 ${files.length} 个 v1 恢复包\n${files.join('\n')}`)).catch(error=>{console.error(error.message);process.exitCode=1;});
}
