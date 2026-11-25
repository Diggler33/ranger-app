// OS grid references (e.g. "NY249210") <-> GPS latitude/longitude (WGS84).
// Standard Ordnance Survey formulas: transverse Mercator on Airy 1830 plus a Helmert datum shift
// (accurate to a few metres, which is plenty for 100 m grid squares).
const OSGrid = (() => {
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const AIRY = { a: 6377563.396, b: 6356256.909 };
  const WGS84 = { a: 6378137, b: 6356752.314245 };
  const F0 = 0.9996012717, LAT0 = rad(49), LON0 = rad(-2), N0 = -100000, E0 = 400000;
  // WGS84 -> OSGB36 (metres, ppm, arc-seconds). Negate all of these for the reverse direction.
  const TO_OSGB = { tx: -446.448, ty: 125.157, tz: -542.060, s: 20.4894, rx: -0.1502, ry: -0.2470, rz: -0.8421 };

  function toCart(lat, lon, e) {
    const e2 = 1 - (e.b * e.b) / (e.a * e.a), s = Math.sin(lat), c = Math.cos(lat);
    const nu = e.a / Math.sqrt(1 - e2 * s * s);
    return [nu * c * Math.cos(lon), nu * c * Math.sin(lon), (1 - e2) * nu * s];
  }
  function fromCart([x, y, z], e) {
    const e2 = 1 - (e.b * e.b) / (e.a * e.a), p = Math.hypot(x, y);
    let lat = Math.atan2(z, p * (1 - e2)), prev = 2 * Math.PI;
    for (let i = 0; i < 20 && Math.abs(lat - prev) > 1e-12; i++) {
      const nu = e.a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
      prev = lat;
      lat = Math.atan2(z + e2 * nu * Math.sin(lat), p);
    }
    return [lat, Math.atan2(y, x)];
  }
  function helmert([x, y, z], t, sign) {
    const k = sign, s1 = 1 + k * t.s / 1e6;
    const rx = rad(k * t.rx / 3600), ry = rad(k * t.ry / 3600), rz = rad(k * t.rz / 3600);
    return [k * t.tx + x * s1 - y * rz + z * ry,
            k * t.ty + x * rz + y * s1 - z * rx,
            k * t.tz - x * ry + y * rx + z * s1];
  }
  function meridional(lat) {
    const { a, b } = AIRY, n = (a - b) / (a + b), n2 = n * n, n3 = n2 * n, d = lat - LAT0, s = lat + LAT0;
    return b * F0 * ((1 + n + 1.25 * n2 + 1.25 * n3) * d
      - (3 * n + 3 * n2 + 2.625 * n3) * Math.sin(d) * Math.cos(s)
      + (1.875 * n2 + 1.875 * n3) * Math.sin(2 * d) * Math.cos(2 * s)
      - (35 / 24) * n3 * Math.sin(3 * d) * Math.cos(3 * s));
  }

  // OSGB36 lat/lon (radians) -> easting/northing
  function project(lat, lon) {
    const { a, b } = AIRY, e2 = 1 - (b * b) / (a * a);
    const s = Math.sin(lat), c = Math.cos(lat), t2 = Math.tan(lat) ** 2, t4 = t2 * t2;
    const nu = a * F0 / Math.sqrt(1 - e2 * s * s), rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5);
    const eta2 = nu / rho - 1, M = meridional(lat), dl = lon - LON0;
    const c3 = c ** 3, c5 = c ** 5;
    const II = nu / 2 * s * c, III = nu / 24 * s * c3 * (5 - t2 + 9 * eta2), IIIA = nu / 720 * s * c5 * (61 - 58 * t2 + t4);
    const IV = nu * c, V = nu / 6 * c3 * (nu / rho - t2), VI = nu / 120 * c5 * (5 - 18 * t2 + t4 + 14 * eta2 - 58 * t2 * eta2);
    return {
      e: E0 + IV * dl + V * dl ** 3 + VI * dl ** 5,
      n: M + N0 + II * dl ** 2 + III * dl ** 4 + IIIA * dl ** 6,
    };
  }
  // easting/northing -> OSGB36 lat/lon (radians)
  function unproject(E, N) {
    const { a, b } = AIRY, e2 = 1 - (b * b) / (a * a);
    let lat = LAT0, M = 0;
    do { lat = (N - N0 - M) / (a * F0) + lat; M = meridional(lat); } while (Math.abs(N - N0 - M) >= 0.00001);
    const s = Math.sin(lat), c = Math.cos(lat), t = Math.tan(lat), t2 = t * t, t4 = t2 * t2, t6 = t4 * t2, sec = 1 / c;
    const nu = a * F0 / Math.sqrt(1 - e2 * s * s), rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5), eta2 = nu / rho - 1;
    const VII = t / (2 * rho * nu), VIII = t / (24 * rho * nu ** 3) * (5 + 3 * t2 + eta2 - 9 * t2 * eta2);
    const IX = t / (720 * rho * nu ** 5) * (61 + 90 * t2 + 45 * t4);
    const X = sec / nu, XI = sec / (6 * nu ** 3) * (nu / rho + 2 * t2), XII = sec / (120 * nu ** 5) * (5 + 28 * t2 + 24 * t4);
    const XIIA = sec / (5040 * nu ** 7) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);
    const dE = E - E0;
    return [lat - VII * dE ** 2 + VIII * dE ** 4 - IX * dE ** 6,
            LON0 + X * dE - XI * dE ** 3 + XII * dE ** 5 - XIIA * dE ** 7];
  }

  // "NY 249 210" -> { e, n } of the centre of that square; null if it can't be read.
  function parse(ref) {
    const m = String(ref || '').toUpperCase().replace(/\s+/g, '').match(/^([A-HJ-Z])([A-HJ-Z])(\d*)$/);
    if (!m || m[3].length % 2) return null;
    let l1 = m[1].charCodeAt(0) - 65, l2 = m[2].charCodeAt(0) - 65;
    if (l1 > 7) l1--; if (l2 > 7) l2--;
    const e100 = ((l1 - 2) % 5) * 5 + (l2 % 5), n100 = (19 - Math.floor(l1 / 5) * 5) - Math.floor(l2 / 5);
    if (e100 < 0 || e100 > 6 || n100 < 0 || n100 > 12) return null;
    const half = m[3].length / 2, size = half ? 10 ** (5 - half) : 100000;
    const de = half ? +m[3].slice(0, half) * size : 0, dn = half ? +m[3].slice(half) * size : 0;
    return { e: e100 * 1e5 + de + size / 2, n: n100 * 1e5 + dn + size / 2 };
  }
  function format(E, N, digits = 6) {
    const e100 = Math.floor(E / 1e5), n100 = Math.floor(N / 1e5);
    if (e100 < 0 || e100 > 6 || n100 < 0 || n100 > 12) return '';
    let l1 = (19 - n100) - (19 - n100) % 5 + Math.floor((e100 + 10) / 5);
    let l2 = ((19 - n100) * 5) % 25 + e100 % 5;
    if (l1 > 7) l1++; if (l2 > 7) l2++;
    const half = digits / 2, div = 10 ** (5 - half);
    const pad = v => String(Math.floor((v % 1e5) / div)).padStart(half, '0');
    return String.fromCharCode(l1 + 65, l2 + 65) + pad(E) + pad(N);
  }

  return {
    // grid reference -> { lat, lon } in GPS degrees, or null
    toLatLon(ref) {
      const p = parse(ref);
      if (!p) return null;
      const [la, lo] = unproject(p.e, p.n);
      const [lat, lon] = fromCart(helmert(toCart(la, lo, AIRY), TO_OSGB, -1), WGS84);
      return { lat: deg(lat), lon: deg(lon) };
    },
    // GPS degrees -> "NY266233" (6 figures = 100 m square by default)
    fromLatLon(lat, lon, digits = 6) {
      const [la, lo] = fromCart(helmert(toCart(rad(lat), rad(lon), WGS84), TO_OSGB, 1), AIRY);
      const { e, n } = project(la, lo);
      return format(e, n, digits);
    },
    pretty(ref) {
      const r = String(ref || '').toUpperCase().replace(/\s+/g, '');
      const d = r.slice(2), h = d.length / 2;
      return h ? `${r.slice(0, 2)} ${d.slice(0, h)} ${d.slice(h)}` : r;
    },
  };
})();
