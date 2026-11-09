const https = require("node:https");
const dns = require("node:dns").promises;
const net = require("node:net");
const {
  ensure,
  imageInfo,
  LIMITS,
  WardrobeError,
} = require("./wardrobeBundle");
const { requestHash } = require("./inspirationContract");
const fileSchema = {
  type: "object",
  additionalProperties: false,
  required: ["file_id", "download_url"],
  properties: {
    file_id: { type: "string", minLength: 1, maxLength: 300 },
    download_url: { type: "string", format: "uri", maxLength: 4000 },
    mime_type: {
      type: "string",
      enum: ["image/jpeg", "image/png", "image/webp"],
    },
    file_name: { type: "string", maxLength: 240 },
  },
};
const fileHash = (file) =>
  requestHash({
    file_id: file.file_id,
    mime_type: file.mime_type || null,
    file_name: file.file_name || null,
  });
function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || b === 2)) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (net.isIP(address) === 6)
    return /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:0?db8:/i.test(address);
  return false;
}
async function downloadImage(
  file,
  {
    hosts = String(process.env.NMDD_MCP_FILE_HOSTS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    lookup = dns.lookup,
    request = https.get,
  } = {},
) {
  const deadline = Date.now() + 15000;
  let url;
  try {
    url = new URL(file.download_url);
  } catch {
    throw new WardrobeError("附件下载地址无效");
  }
  ensure(
    url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      (!url.port || url.port === "443"),
    "附件必须来自 HTTPS 图片服务",
  );
  ensure(
    url.hostname.endsWith(".oaiusercontent.com") ||
      hosts.includes(url.hostname),
    "附件域名未获许可，请在网站上传图片后使用 image_id",
  );
  let lookupTimer;
  const addresses = await Promise.race([
    lookup(url.hostname, { all: true, verbatim: true }),
    new Promise((_, reject) => {
      lookupTimer = setTimeout(
        () => reject(new WardrobeError("附件地址解析超时")),
        15000,
      );
      lookupTimer.unref();
    }),
  ]).finally(() => clearTimeout(lookupTimer));
  ensure(
    addresses.length && addresses.every((row) => publicAddress(row.address)),
    "附件地址不能指向本地或私有网络",
  );
  const address = addresses[0];
  const { bytes, mime } = await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        lookup: (_hostname, opts, callback) =>
          opts?.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
        headers: { Accept: "image/jpeg,image/png,image/webp" },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          reject(new WardrobeError("附件下载失败或地址已过期，请重新上传"));
          return;
        }
        const mime = String(res.headers["content-type"] || "").split(";")[0];
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(mime) ||
          Number(res.headers["content-length"] || 0) > LIMITS.image
        ) {
          res.destroy();
          reject(new WardrobeError("附件类型或大小不符合要求"));
          return;
        }
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > LIMITS.image) {
            res.destroy();
            reject(new WardrobeError("图片不能超过 8MB"));
          } else chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("end", () => resolve({ bytes: Buffer.concat(chunks), mime }));
      },
    );
    // Absolute deadline includes DNS/TLS and the body. Redirects are deliberately rejected.
    const timer = setTimeout(
      () => req.destroy(new WardrobeError("附件下载超时")),
      Math.max(1, deadline - Date.now()),
    );
    timer.unref();
    req.on("close", () => clearTimeout(timer));
    req.on("error", reject);
  });
  const filename =
    file.file_name ||
    `attachment.${mime === "image/jpeg" ? "jpg" : mime.slice(6)}`;
  imageInfo(bytes, filename, file.mime_type || mime);
  return { bytes, filename, mimetype: mime };
}
module.exports = { fileSchema, fileHash, publicAddress, downloadImage };
