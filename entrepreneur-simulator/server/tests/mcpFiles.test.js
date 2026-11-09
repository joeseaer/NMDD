const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const { downloadImage, fileHash } = require("../services/mcpFiles");
const { LIMITS } = require("../services/wardrobeBundle");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGa8AAAAASUVORK5CYII=",
  "base64",
);
const file = {
  file_id: "file-1",
  download_url: "https://files.oaiusercontent.com/image?secret=short-lived",
  file_name: "test.png",
  mime_type: "image/png",
};
function remote({
  status = 200,
  mime = "image/png",
  size = png.length,
  chunks = [png],
} = {}) {
  const state = {};
  const request = (url, options, done) => {
    state.url = url;
    state.options = options;
    const req = new EventEmitter();
    req.destroy = (error) => {
      req.emit("error", error);
      req.emit("close");
    };
    queueMicrotask(() => {
      const res = Readable.from(chunks);
      res.statusCode = status;
      res.headers = { "content-type": mime, "content-length": size };
      res.on("close", () => req.emit("close"));
      done(res);
    });
    return req;
  };
  return {
    state,
    request,
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
  };
}
test("attachment transport pins the checked public address, retains binary bytes and excludes ephemeral URL from retries", async () => {
  const mock = remote(),
    image = await downloadImage(file, mock);
  assert.deepEqual(image.bytes, png);
  assert.equal(image.mimetype, "image/png");
  await new Promise((resolve, reject) =>
    mock.state.options.lookup(
      "files.oaiusercontent.com",
      {},
      (error, address, family) => {
        if (error) return reject(error);
        assert.equal(address, "8.8.8.8");
        assert.equal(family, 4);
        resolve();
      },
    ),
  );
  assert.equal(
    fileHash(file),
    fileHash({
      ...file,
      download_url: "https://files.oaiusercontent.com/renewed",
    }),
  );
});
test("attachment transport rejects redirects, misleading MIME/content, excessive length and chunked overflows", async () => {
  await assert.rejects(
    downloadImage(file, remote({ status: 302 })),
    /下载失败/,
  );
  await assert.rejects(
    downloadImage(file, remote({ mime: "text/html" })),
    /类型或大小/,
  );
  await assert.rejects(
    downloadImage(file, remote({ size: LIMITS.image + 1 })),
    /类型或大小/,
  );
  await assert.rejects(
    downloadImage(
      file,
      remote({
        size: 0,
        chunks: [Buffer.alloc(LIMITS.image), Buffer.from("x")],
      }),
    ),
    /8MB/,
  );
  await assert.rejects(
    downloadImage(
      file,
      remote({ chunks: [Buffer.from("<html>not a picture</html>")] }),
    ),
    /文件头/,
  );
});
test("attachment address validation checks every DNS result and rejects HTTPS credentials/ports/unauthorized hosts", async () => {
  for (const download_url of [
    "https://user:pass@files.oaiusercontent.com/x",
    "https://files.oaiusercontent.com:8443/x",
    "https://files.oaiusercontent.com.attacker.invalid/x",
  ])
    await assert.rejects(downloadImage({ ...file, download_url }, remote()));
  await assert.rejects(
    downloadImage(file, {
      ...remote(),
      lookup: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    }),
    /私有网络/,
  );
});
