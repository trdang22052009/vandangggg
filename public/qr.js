/* Bộ tạo mã QR nhỏ gọn, không phụ thuộc thư viện ngoài.
   Chế độ byte (UTF-8), mức sửa lỗi L/M/Q/H, phiên bản 1–10, tự chọn mặt nạ.
   Dùng: const qr = QR.encode("https://...", "M"); qr.size; qr.get(x, y) */
(function (root) {
  "use strict";

  var ECL = { L: 1, M: 0, Q: 3, H: 2 };
  var ORD = { L: 0, M: 1, Q: 2, H: 3 };

  // Số byte sửa lỗi mỗi khối và số khối, theo mức sửa lỗi (L, M, Q, H) và phiên bản 1..10
  var ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28]
  ];
  var NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8]
  ];

  function utf8(str) {
    var out = [];
    var s = unescape(encodeURIComponent(str));
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }

  function dataCodewords(ver, ecl) {
    var o = ORD[ecl];
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[o][ver] * NUM_BLOCKS[o][ver];
  }

  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    var res = [];
    for (var i = 0; i < degree; i++) res.push(0);
    res[degree - 1] = 1;
    var root = 1;
    for (var k = 0; k < degree; k++) {
      for (var j = 0; j < degree; j++) {
        res[j] = gfMul(res[j], root);
        if (j + 1 < degree) res[j] ^= res[j + 1];
      }
      root = gfMul(root, 2);
    }
    return res;
  }

  function rsRemainder(data, divisor) {
    var res = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ res.shift();
      res.push(0);
      divisor.forEach(function (coef, i) { res[i] ^= gfMul(coef, factor); });
    });
    return res;
  }

  function addEccAndInterleave(data, ver, ecl) {
    var o = ORD[ecl];
    var numBlocks = NUM_BLOCKS[o][ver];
    var blockEcc = ECC_PER_BLOCK[o][ver];
    var raw = Math.floor(rawModules(ver) / 8);
    var numShort = numBlocks - (raw % numBlocks);
    var shortLen = Math.floor(raw / numBlocks);
    var blocks = [];
    var div = rsDivisor(blockEcc);
    for (var i = 0, k = 0; i < numBlocks; i++) {
      var len = shortLen - blockEcc + (i < numShort ? 0 : 1);
      var dat = data.slice(k, k + len);
      k += len;
      var ecc = rsRemainder(dat, div);
      if (i < numShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var result = [];
    for (var c = 0; c < blocks[0].length; c++) {
      for (var j = 0; j < blocks.length; j++) {
        if (c !== shortLen - blockEcc || j >= numShort) result.push(blocks[j][c]);
      }
    }
    return result;
  }

  function bit(x, i) { return ((x >>> i) & 1) !== 0; }

  function Qr(ver, ecl, codewords) {
    this.version = ver;
    this.size = ver * 4 + 17;
    this.ecl = ecl;
    var n = this.size;
    this.modules = [];
    this.isFn = [];
    for (var y = 0; y < n; y++) {
      var a = [], b = [];
      for (var x = 0; x < n; x++) { a.push(false); b.push(false); }
      this.modules.push(a);
      this.isFn.push(b);
    }
    this.drawFunctionPatterns();
    this.drawCodewords(addEccAndInterleave(codewords, ver, ecl));

    var best = 0, min = Infinity;
    for (var m = 0; m < 8; m++) {
      this.applyMask(m);
      this.drawFormatBits(m);
      var p = this.penalty();
      if (p < min) { min = p; best = m; }
      this.applyMask(m);
    }
    this.mask = best;
    this.applyMask(best);
    this.drawFormatBits(best);
    this.isFn = null;
  }

  Qr.prototype.get = function (x, y) {
    return x >= 0 && x < this.size && y >= 0 && y < this.size && this.modules[y][x];
  };

  Qr.prototype.setFn = function (x, y, dark) {
    this.modules[y][x] = dark;
    this.isFn[y][x] = true;
  };

  Qr.prototype.drawFunctionPatterns = function () {
    var n = this.size, i;
    for (i = 0; i < n; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(n - 4, 3);
    this.finder(3, n - 4);
    var pos = this.alignPositions();
    var na = pos.length;
    for (i = 0; i < na; i++) {
      for (var j = 0; j < na; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
        this.align(pos[i], pos[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  };

  Qr.prototype.alignPositions = function () {
    var ver = this.version;
    if (ver === 1) return [];
    var na = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
    var res = [6];
    for (var p = this.size - 7; res.length < na; p -= step) res.splice(1, 0, p);
    return res;
  };

  Qr.prototype.finder = function (cx, cy) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        var x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFn(x, y, d !== 2 && d !== 4);
      }
    }
  };

  Qr.prototype.align = function (cx, cy) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  Qr.prototype.drawFormatBits = function (mask) {
    var data = (ECL[this.ecl] << 3) | mask;
    var rem = data, i;
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    var n = this.size;
    for (i = 0; i <= 5; i++) this.setFn(8, i, bit(bits, i));
    this.setFn(8, 7, bit(bits, 6));
    this.setFn(8, 8, bit(bits, 7));
    this.setFn(7, 8, bit(bits, 8));
    for (i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(bits, i));
    for (i = 0; i < 8; i++) this.setFn(n - 1 - i, 8, bit(bits, i));
    for (i = 8; i < 15; i++) this.setFn(8, n - 15 + i, bit(bits, i));
    this.setFn(8, n - 8, true);
  };

  Qr.prototype.drawVersion = function () {
    if (this.version < 7) return;
    var rem = this.version, i;
    for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    var bits = (this.version << 12) | rem;
    for (i = 0; i < 18; i++) {
      var c = bit(bits, i);
      var a = this.size - 11 + (i % 3);
      var b = Math.floor(i / 3);
      this.setFn(a, b, c);
      this.setFn(b, a, c);
    }
  };

  Qr.prototype.drawCodewords = function (data) {
    var n = this.size, i = 0;
    for (var right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < n; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? n - 1 - vert : vert;
          if (!this.isFn[y][x] && i < data.length * 8) {
            this.modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  };

  Qr.prototype.applyMask = function (mask) {
    var n = this.size;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        var inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break;
          case 1: inv = y % 2 === 0; break;
          case 2: inv = x % 3 === 0; break;
          case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (inv && !this.isFn[y][x]) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  Qr.prototype.penalty = function () {
    var n = this.size, m = this.modules, score = 0, x, y, k;
    var dark = 0;
    // Dãy ô cùng màu và mẫu giống mắt định vị, theo hàng rồi theo cột
    for (var pass = 0; pass < 2; pass++) {
      for (var a = 0; a < n; a++) {
        var line = [];
        for (var b = 0; b < n; b++) line.push(pass === 0 ? m[a][b] : m[b][a]);
        var run = 1;
        for (k = 1; k < n; k++) {
          if (line[k] === line[k - 1]) {
            run++;
            if (run === 5) score += 3; else if (run > 5) score += 1;
          } else run = 1;
        }
        var s = line.map(function (v) { return v ? "1" : "0"; }).join("");
        var pos = -1;
        while ((pos = s.indexOf("10111010000", pos + 1)) !== -1) score += 40;
        pos = -1;
        while ((pos = s.indexOf("00001011101", pos + 1)) !== -1) score += 40;
      }
    }
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        if (m[y][x]) dark++;
        if (x < n - 1 && y < n - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
      }
    }
    var total = n * n;
    score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
    return score;
  };

  function encode(text, eclName) {
    var ecl = ECC_PER_BLOCK[ORD[eclName || "M"]] ? (eclName || "M") : "M";
    var bytes = utf8(text);
    var ver, capBits;
    for (ver = 1; ver <= 10; ver++) {
      var ccBits = ver < 10 ? 8 : 16;
      capBits = dataCodewords(ver, ecl) * 8;
      if (4 + ccBits + bytes.length * 8 <= capBits) break;
    }
    if (ver > 10) throw new Error("Địa chỉ quá dài để tạo mã QR");

    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    push(4, 4);
    push(bytes.length, ver < 10 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    push(0, Math.min(4, capBits - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < capBits; pad ^= 0xec ^ 0x11) push(pad, 8);

    var cw = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      cw.push(v);
    }
    return new Qr(ver, ecl, cw);
  }

  /* Vẽ mã QR vào canvas, có viền trắng 4 ô để máy quét nhận dạng dễ. */
  function draw(canvas, text, px, ecl) {
    var qr = encode(text, ecl || "M");
    var quiet = 4;
    var cells = qr.size + quiet * 2;
    var scale = Math.max(1, Math.floor(px / cells));
    var side = cells * scale;
    canvas.width = side;
    canvas.height = side;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = "#101208";
    for (var y = 0; y < qr.size; y++) {
      for (var x = 0; x < qr.size; x++) {
        if (qr.get(x, y)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
      }
    }
    return qr;
  }

  var api = { encode: encode, draw: draw };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.QR = api;
})(typeof window !== "undefined" ? window : this);
