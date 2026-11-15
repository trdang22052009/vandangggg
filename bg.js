/* Vẽ nền đường đồng mức (bản đồ địa hình) bằng canvas — vẽ một lần, không tốn máy khi trình chiếu. */
(function () {
  "use strict";
  var cv = document.getElementById("bg");
  if (!cv || !cv.getContext) return;
  var ctx = cv.getContext("2d");

  function rnd(ix, iy) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function vnoise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    var a = rnd(ix, iy), b = rnd(ix + 1, iy), c = rnd(ix, iy + 1), d = rnd(ix + 1, iy + 1);
    var u = smooth(fx), v = smooth(fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function field(x, y) {
    return vnoise(x + 3.7, y + 9.1) * 0.56 + vnoise(x * 2.1 + 11, y * 2.1 + 7) * 0.30 + vnoise(x * 4.3 + 3, y * 4.3 + 19) * 0.14;
  }

  function draw() {
    var w = window.innerWidth, h = window.innerHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var big = Math.max(w, h);
    var cell = Math.max(8, Math.round(big / 120));
    var freq = 1 / (big / 3.3);
    var cols = Math.ceil(w / cell) + 2, rows = Math.ceil(h / cell) + 2;
    var vals = new Float32Array(cols * rows);
    var j, i, k;
    for (j = 0; j < rows; j++) for (i = 0; i < cols; i++) vals[j * cols + i] = field(i * cell * freq, j * cell * freq);

    // Bảng đoạn thẳng cho 16 trường hợp: các cạnh 0=trên, 1=phải, 2=dưới, 3=trái
    var SEG = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[0, 3], [2, 1]], [[0, 2]], [[0, 3]],
      [[0, 3]], [[0, 2]], [[0, 1], [3, 2]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];

    var levelCount = 17, start = 0.27, step = 0.027;
    for (k = 0; k < levelCount; k++) {
      var thr = start + k * step;
      var major = k % 4 === 0;
      ctx.beginPath();
      for (j = 0; j < rows - 1; j++) {
        for (i = 0; i < cols - 1; i++) {
          var tl = vals[j * cols + i], tr = vals[j * cols + i + 1];
          var bl = vals[(j + 1) * cols + i], br = vals[(j + 1) * cols + i + 1];
          var idx = (tl > thr ? 8 : 0) | (tr > thr ? 4 : 0) | (br > thr ? 2 : 0) | (bl > thr ? 1 : 0);
          if (idx === 0 || idx === 15) continue;
          var x0 = i * cell, y0 = j * cell;
          var pts = [
            [x0 + cell * ((thr - tl) / (tr - tl)), y0],
            [x0 + cell, y0 + cell * ((thr - tr) / (br - tr))],
            [x0 + cell * ((thr - bl) / (br - bl)), y0 + cell],
            [x0, y0 + cell * ((thr - tl) / (bl - tl))]
          ];
          var segs = SEG[idx];
          for (var s = 0; s < segs.length; s++) {
            var p = pts[segs[s][0]], q = pts[segs[s][1]];
            ctx.moveTo(p[0], p[1]);
            ctx.lineTo(q[0], q[1]);
          }
        }
      }
      ctx.lineWidth = major ? 1.5 : 0.8;
      ctx.strokeStyle = major ? "rgba(222, 210, 160, 0.26)" : "rgba(222, 210, 160, 0.11)";
      ctx.stroke();
    }
  }

  var timer = null;
  window.addEventListener("resize", function () {
    clearTimeout(timer);
    timer = setTimeout(draw, 150);
  });
  draw();
})();
